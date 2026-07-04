#!/usr/bin/env python3
"""Import Engine DJ hot cues and beatgrids into manadj (prototype).

Decodes Engine DJ's PerformanceData BLOBs (beatData, quickCues) and copies
them onto matched manadj Tracks that don't already have them. Iteration tool
first, backfill tool second: dry-run by default, with --show for byte-level
diagnostics on a handful of tracks.

Blob decoding lives in enginedj.performance_blobs (see its docstring for the
format). Positions are samples; divide by the blob's own sample rate for
seconds.
"""

import argparse
import json
import sys
from pathlib import Path

from backend.database import SessionLocal
from backend.models import Beatgrid as DBBeatgrid
from backend.models import HotCue as DBHotCue
from backend.models import Track as DBTrack
from backend.sync_common.matching import TrackIndex
from enginedj import EngineDJDatabase
from enginedj.models.performance_data import PerformanceData
from enginedj.models.track import Track as EDJTrack
from enginedj.performance_blobs import (
    BeatData,
    BlobParseError,
    QuickCues,
    parse_beat_data,
    parse_quick_cues,
)
from enginedj.sync import edj_path


# ── Conversion to manadj shapes ──────────────────────────────────────────


def grid_to_tempo_changes(beat_data: BeatData) -> list[dict]:
    """Convert an Engine beatgrid (adjusted, falling back to default) to
    manadj tempo_changes_json entries.

    Engine markers span beat -4 to beat N+1; manadj wants tempo changes at
    non-negative times with bar positions. Beat 0 is taken as a downbeat
    (bar_position 1), matching Engine's bar convention.
    """
    grid = beat_data.adjusted_grid or beat_data.default_grid
    if len(grid) < 2:
        raise BlobParseError(f"beatgrid has {len(grid)} markers, need >= 2")

    rate = beat_data.sample_rate
    changes: list[dict] = []
    for a, b in zip(grid, grid[1:]):
        beats = b.beat_index - a.beat_index
        samples = b.sample_offset - a.sample_offset
        if beats <= 0 or samples <= 0:
            raise BlobParseError(
                f"non-monotonic grid: beats {a.beat_index}->{b.beat_index}, "
                f"samples {a.sample_offset:.0f}->{b.sample_offset:.0f}"
            )
        bpm = rate * 60.0 * beats / samples
        spb = samples / beats  # samples per beat in this segment

        # Walk this segment's start forward to the first beat at t >= 0
        start_index = a.beat_index
        start_offset = a.sample_offset
        while start_offset < 0:
            start_offset += spb
            start_index += 1
        if start_index >= b.beat_index and b is not grid[-1]:
            continue  # segment ends before the track starts

        changes.append({
            "start_time": start_offset / rate,
            "bpm": round(bpm, 4),
            "time_signature_num": 4,
            "time_signature_den": 4,
            "bar_position": (start_index % 4) + 1 if start_index % 4 else 1,
        })

    if not changes:
        raise BlobParseError("no usable tempo changes (grid entirely before track start?)")
    return changes


def hot_cue_rows(track_id: int, cues: QuickCues, sample_rate: float) -> list[DBHotCue]:
    rows = []
    for cue in cues.hot_cues:
        if cue.sample_offset < 0:
            continue
        rows.append(
            DBHotCue(
                track_id=track_id,
                slot_number=cue.slot + 1,  # Engine 0-7 -> manadj 1-8
                time_seconds=cue.sample_offset / sample_rate,
                label=cue.label or None,
                color=cue.color_hex,
            )
        )
    return rows


def is_auto_generated_grid(tempo_changes: list[dict], track_bpm_centi: int | None) -> bool:
    """True if an existing manadj beatgrid matches the shape produced by
    generate_beatgrid_from_bpm: a single constant-BPM change at t=0 with the
    track's own BPM. Anything else is treated as curated and preserved."""
    if track_bpm_centi is None or len(tempo_changes) != 1:
        return False
    tc = tempo_changes[0]
    return (
        tc.get("start_time") == 0.0
        and tc.get("bar_position") == 1
        and abs(tc.get("bpm", 0.0) - track_bpm_centi / 100.0) < 0.005
    )


# ── Import driver ────────────────────────────────────────────────────────


def fmt_time(seconds: float) -> str:
    m = int(seconds // 60)
    return f"{m}:{seconds - m * 60:04.1f}"


def describe_candidate(db_track, beat_data, tempo_changes, cue_rows, quick_cues, edj_bpm):
    name = Path(db_track.filename).name
    print(f"\n── {db_track.artist or '?'} - {db_track.title or '?'}  ({name})")
    if beat_data:
        grid = beat_data.adjusted_grid or beat_data.default_grid
        adj = "adjusted" if beat_data.adjusted_grid else "default"
        print(f"  beatgrid ({adj}): {len(grid)} markers @ {beat_data.sample_rate:.0f}Hz")
        for m in grid:
            print(f"    beat {m.beat_index:>5} @ sample {m.sample_offset:>14.2f} "
                  f"({m.sample_offset / beat_data.sample_rate:>8.3f}s), {m.beats_to_next} beats to next")
        for tc in tempo_changes or []:
            print(f"    -> tempo change: {tc['bpm']} BPM from {fmt_time(tc['start_time'])} "
                  f"(bar pos {tc['bar_position']})")
        if edj_bpm and tempo_changes:
            drift = abs(tempo_changes[0]["bpm"] - edj_bpm)
            flag = "  ⚠ DRIFT" if drift > 0.05 else ""
            print(f"    engine bpmAnalyzed={edj_bpm:.2f}, grid bpm={tempo_changes[0]['bpm']:.2f}{flag}")
    if cue_rows:
        for row in cue_rows:
            print(f"  hot cue {row.slot_number}: {fmt_time(row.time_seconds)} "
                  f"{row.color or ''} {row.label or ''}")
    if quick_cues and quick_cues.main_cue_overridden:
        rate = beat_data.sample_rate if beat_data else 44100.0
        print(f"  (info) user main cue @ {fmt_time(quick_cues.main_cue_samples / rate)} — not imported")


def run(engine_db_path: str, apply: bool, limit: int | None, match: str | None, show: int):
    edj_db = EngineDJDatabase(Path(engine_db_path))
    db = SessionLocal()

    stats = {
        "scanned": 0, "not_in_engine": 0, "no_performance_data": 0,
        "parse_errors": 0, "has_hotcues_skipped": 0,
        "beatgrids_imported": 0, "beatgrids_replaced_auto": 0,
        "curated_beatgrids_kept": 0, "variable_grids_skipped": 0,
        "drift_grids_skipped": 0,
        "hotcue_tracks_imported": 0, "hotcues_imported": 0,
    }
    shown = 0
    imported_tracks = 0

    try:
        with edj_db.session_m() as edj_session:
            db_tracks = db.query(DBTrack).all()
            edj_index = TrackIndex.build(edj_session.query(EDJTrack).all(), edj_path)

            existing_hotcue_track_ids = {tid for (tid,) in db.query(DBHotCue.track_id).distinct()}
            existing_beatgrids = {bg.track_id: bg for bg in db.query(DBBeatgrid).all()}

            for db_track in db_tracks:
                if match and match.lower() not in db_track.filename.lower() \
                        and match.lower() not in (db_track.title or "").lower() \
                        and match.lower() not in (db_track.artist or "").lower():
                    continue
                stats["scanned"] += 1

                edj_track = edj_index.match(db_track.filename)
                if edj_track is None:
                    stats["not_in_engine"] += 1
                    continue

                perf: PerformanceData | None = edj_track.performance_data
                if perf is None or (perf.beatData is None and perf.quickCues is None):
                    stats["no_performance_data"] += 1
                    continue

                name = Path(db_track.filename).name
                beat_data = None
                tempo_changes = None
                quick_cues = None
                cue_rows: list[DBHotCue] = []

                try:
                    if perf.beatData:
                        beat_data = parse_beat_data(perf.beatData)
                        tempo_changes = grid_to_tempo_changes(beat_data)
                    if perf.quickCues and beat_data:
                        quick_cues = parse_quick_cues(perf.quickCues)
                        cue_rows = hot_cue_rows(db_track.id, quick_cues, beat_data.sample_rate)
                except BlobParseError as e:
                    stats["parse_errors"] += 1
                    print(f"[parse error] {name}: {e}")
                    continue

                edj_bpm = float(edj_track.bpmAnalyzed) if edj_track.bpmAnalyzed else None

                # Beatgrid policy: only clean, constant grids come over.
                # Variable grids (multiple tempo changes) and grids whose BPM
                # disagrees with Engine's own analysis are deferred.
                want_beatgrid = tempo_changes is not None
                replace_existing_grid = False
                if want_beatgrid and len(tempo_changes) > 1:
                    stats["variable_grids_skipped"] += 1
                    want_beatgrid = False
                if want_beatgrid and edj_bpm and abs(tempo_changes[0]["bpm"] - edj_bpm) > 0.05:
                    stats["drift_grids_skipped"] += 1
                    want_beatgrid = False
                if want_beatgrid and db_track.id in existing_beatgrids:
                    existing = existing_beatgrids[db_track.id]
                    if is_auto_generated_grid(json.loads(existing.tempo_changes_json), db_track.bpm):
                        replace_existing_grid = True
                    else:
                        stats["curated_beatgrids_kept"] += 1
                        want_beatgrid = False

                want_hotcues = bool(cue_rows) and db_track.id not in existing_hotcue_track_ids
                if cue_rows and db_track.id in existing_hotcue_track_ids:
                    stats["has_hotcues_skipped"] += 1

                if not want_beatgrid and not want_hotcues:
                    continue

                if limit is not None and imported_tracks >= limit:
                    continue
                imported_tracks += 1

                if shown < show:
                    describe_candidate(db_track, beat_data, tempo_changes, cue_rows, quick_cues, edj_bpm)
                    shown += 1

                if want_beatgrid:
                    if replace_existing_grid:
                        stats["beatgrids_replaced_auto"] += 1
                        if apply:
                            existing_beatgrids[db_track.id].tempo_changes_json = json.dumps(tempo_changes)
                    else:
                        stats["beatgrids_imported"] += 1
                        if apply:
                            db.add(DBBeatgrid(
                                track_id=db_track.id,
                                tempo_changes_json=json.dumps(tempo_changes),
                            ))
                if want_hotcues:
                    stats["hotcue_tracks_imported"] += 1
                    stats["hotcues_imported"] += len(cue_rows)
                    if apply:
                        for row in cue_rows:
                            db.add(row)

            if apply:
                db.commit()
                print("\n✓ Changes committed")

    finally:
        db.close()

    print("\n" + "=" * 70)
    print(f"Engine DJ performance data import — {'APPLIED' if apply else 'DRY RUN'}")
    print("=" * 70)
    for key, value in stats.items():
        print(f"  {key}: {value}")
    if limit is not None:
        print(f"  (limited to {limit} tracks)")
    if not apply:
        print("\nRe-run with --apply to write.")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("engine_db_path", help="Path to Engine DJ Database2 directory")
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry run)")
    parser.add_argument("--limit", type=int, default=None, help="Import at most N tracks")
    parser.add_argument("--match", default=None, help="Only tracks whose filename/title/artist contains this")
    parser.add_argument("--show", type=int, default=5, help="Print detailed parse for first N imported tracks")
    args = parser.parse_args()

    if not Path(args.engine_db_path).exists():
        print(f"Error: path does not exist: {args.engine_db_path}")
        sys.exit(1)

    run(args.engine_db_path, args.apply, args.limit, args.match, args.show)


if __name__ == "__main__":
    main()

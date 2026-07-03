#!/usr/bin/env python3
"""Import Engine DJ hot cues and beatgrids into manadj (prototype).

Decodes Engine DJ's PerformanceData BLOBs (beatData, quickCues) and copies
them onto matched manadj Tracks that don't already have them. Iteration tool
first, backfill tool second: dry-run by default, with --show for byte-level
diagnostics on a handful of tracks.

Blob format per the Mixxx wiki (Engine Library Format) and libdjinterop:
- BLOBs are qCompress-framed: 4-byte big-endian uncompressed length + zlib.
- beatData: sample rate (f64 BE), track length in samples (f64 BE),
  is-set byte, then two beatgrids (default, adjusted). Each grid: marker
  count (i64 BE), then markers of (sample offset f64 LE, beat index i64 LE,
  beats-to-next u32 LE, unknown u32 LE). First marker is beat -4.
- quickCues: cue count (i64 BE, always 8), then per cue: label length byte,
  label bytes, position in samples (f64 BE, -1 if unset), ARGB bytes; then
  main cue position (f64 BE), is-overridden byte, default cue (f64 BE).

Positions are samples; divide by the blob's own sample rate for seconds.
"""

import argparse
import json
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

from backend.database import SessionLocal
from backend.models import Beatgrid as DBBeatgrid
from backend.models import HotCue as DBHotCue
from backend.models import Track as DBTrack
from backend.sync_common.matching import TrackIndex
from enginedj import EngineDJDatabase
from enginedj.models.performance_data import PerformanceData
from enginedj.models.track import Track as EDJTrack
from enginedj.sync import edj_path

PLAUSIBLE_SAMPLE_RATES = (22050.0, 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0)


# ── Blob parsing ─────────────────────────────────────────────────────────


class BlobParseError(Exception):
    pass


def q_uncompress(blob: bytes) -> bytes:
    """Undo Qt's qCompress framing: u32 BE uncompressed length + zlib stream."""
    if len(blob) < 5:
        raise BlobParseError(f"blob too short ({len(blob)} bytes)")
    (expected_len,) = struct.unpack(">I", blob[:4])
    data = zlib.decompress(blob[4:])
    if len(data) != expected_len:
        raise BlobParseError(f"length prefix {expected_len} != decompressed {len(data)}")
    return data


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def read(self, fmt: str):
        size = struct.calcsize(fmt)
        if self.pos + size > len(self.data):
            raise BlobParseError(f"unexpected end of blob at {self.pos} (want {size} bytes)")
        (value,) = struct.unpack_from(fmt, self.data, self.pos)
        self.pos += size
        return value

    def read_bytes(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise BlobParseError(f"unexpected end of blob at {self.pos} (want {n} bytes)")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    @property
    def remaining(self) -> int:
        return len(self.data) - self.pos


@dataclass
class GridMarker:
    sample_offset: float
    beat_index: int
    beats_to_next: int


@dataclass
class BeatData:
    sample_rate: float
    track_length_samples: float
    default_grid: list[GridMarker]
    adjusted_grid: list[GridMarker]


@dataclass
class EngineHotCue:
    slot: int  # 0-7
    label: str
    sample_offset: float
    color_hex: str  # "#RRGGBB"


@dataclass
class QuickCues:
    hot_cues: list[EngineHotCue]  # only set slots
    main_cue_samples: float
    main_cue_overridden: bool
    default_cue_samples: float


def parse_beat_data(blob: bytes) -> BeatData:
    r = Reader(q_uncompress(blob))
    sample_rate = r.read(">d")
    if sample_rate not in PLAUSIBLE_SAMPLE_RATES:
        raise BlobParseError(f"implausible sample rate {sample_rate!r} — endianness/format drift?")
    track_length = r.read(">d")
    is_set = r.read("B")
    if is_set != 1:
        raise BlobParseError(f"beat data is-set flag = {is_set}, expected 1")

    def read_grid() -> list[GridMarker]:
        count = r.read(">q")
        # Heavily warped grids (e.g. Serato imports) can carry hundreds of
        # markers; bound by what the blob could physically hold (24 B/marker).
        if not (0 <= count <= r.remaining // 24):
            raise BlobParseError(f"implausible marker count {count} ({r.remaining} bytes left)")
        markers = []
        for _ in range(count):
            offset = r.read("<d")
            index = r.read("<q")
            beats_to_next = r.read("<I")
            r.read("<I")  # unknown field
            markers.append(GridMarker(offset, index, beats_to_next))
        return markers

    default_grid = read_grid()
    adjusted_grid = read_grid()
    return BeatData(sample_rate, track_length, default_grid, adjusted_grid)


def parse_quick_cues(blob: bytes) -> QuickCues:
    r = Reader(q_uncompress(blob))
    count = r.read(">q")
    if not (0 <= count <= 64):
        raise BlobParseError(f"implausible hot cue count {count}")

    cues: list[EngineHotCue] = []
    for slot in range(count):
        label_len = r.read("B")
        label = r.read_bytes(label_len).decode("utf-8", errors="replace")
        position = r.read(">d")
        a, red, green, blue = (r.read("B"), r.read("B"), r.read("B"), r.read("B"))
        del a
        if label_len > 0 or position >= 0:
            cues.append(EngineHotCue(slot, label, position, f"#{red:02X}{green:02X}{blue:02X}"))

    main_cue = r.read(">d")
    overridden = bool(r.read("B"))
    default_cue = r.read(">d")
    return QuickCues(cues, main_cue, overridden, default_cue)


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

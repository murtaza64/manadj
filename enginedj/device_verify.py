"""Verify an exported Engine device library directory (#268).

Read-only checks over the output of enginedj.device_export (or any
`Engine Library` directory): filesystem layout, SQLite integrity,
schema fidelity against the packaged verbatim 3.0.1 DDL, uuid
freshness/self-containment, audio path existence and containment, blob
decodability, and linked-list invariants. Given a manadj session, also
proves exact projection: playlist order, hot cues, main cue, beatgrid,
key, and rating must match the manadj source.

Never writes anything; safe to point at parent-owned outputs.
"""

from __future__ import annotations

import re
import sqlite3
import struct
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from .device_export import ENGINE_LIBRARY_DIR, MARKER_NAME, SCHEMA_SQL_PATH, USER_VERSION
from .performance_blobs import (
    BlobParseError,
    parse_beat_data,
    parse_quick_cues,
    parse_track_data,
    q_uncompress,
)

CUE_TOLERANCE_SECS = 1e-6
GRID_TOLERANCE_SAMPLES = 1e-3


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class VerifyReport:
    dest_root: Path
    checks: list[Check] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(check.ok for check in self.checks)

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append(Check(name, ok, detail))

    def to_dict(self) -> dict:
        return {
            "dest_root": str(self.dest_root),
            "ok": self.ok,
            "checks": [
                {"name": c.name, "ok": c.ok, "detail": c.detail} for c in self.checks
            ],
        }


def _normalized_ddl(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return sorted(re.sub(r"\s+", " ", sql).strip() for (sql,) in rows)


def _reference_ddl() -> list[str]:
    ref = sqlite3.connect(":memory:")
    try:
        ref.executescript(SCHEMA_SQL_PATH.read_text())
        return _normalized_ddl(ref)
    finally:
        ref.close()


def _walk_linked_list(rows: list[tuple[int, int]]) -> list[int] | None:
    """rows: (id, next_id). Returns traversal order, or None when the
    chain is not a single complete cycle-free list (0 terminator)."""
    if not rows:
        return []
    nexts = dict(rows)
    if len(nexts) != len(rows):
        return None
    pointed = {n for n in nexts.values() if n}
    heads = [i for i in nexts if i not in pointed]
    if len(heads) != 1:
        return None
    order, current, seen = [], heads[0], set()
    while current:
        if current in seen or current not in nexts:
            return None
        seen.add(current)
        order.append(current)
        current = nexts[current]
    return order if len(order) == len(rows) else None


def _parse_loops_raw(raw: bytes) -> None:
    """Minimal loops-blob walk (raw little-endian, #267 research);
    raises on structural corruption."""
    offset = 8
    (count,) = struct.unpack_from("<q", raw, 0)
    if not 0 <= count <= 64:
        raise BlobParseError(f"implausible loop count {count}")
    for _ in range(count):
        label_len = raw[offset]
        offset += 1 + label_len + 16 + 2 + 4
    if offset != len(raw):
        raise BlobParseError(f"loops trailing bytes: {len(raw) - offset}")


def _check_overview(blob: bytes) -> None:
    raw = q_uncompress(blob)
    count1, count2 = struct.unpack_from(">qq", raw, 0)
    if count1 != count2:
        raise BlobParseError("overview count fields disagree")
    if len(raw) != 24 + 3 * (count1 + 1):
        raise BlobParseError(f"overview length {len(raw)} != 24+3*({count1}+1)")


def verify_device_library(
    dest_root: Path, manadj_session: Session | None = None
) -> VerifyReport:
    dest = Path(dest_root).resolve()
    report = VerifyReport(dest_root=dest)
    library_dir = dest / ENGINE_LIBRARY_DIR
    db_path = library_dir / "Database2" / "m.db"

    report.add("layout: Engine Library/Database2/m.db", db_path.is_file(), str(db_path))
    if not db_path.is_file():
        return report
    marker_path = library_dir / MARKER_NAME
    report.add("layout: manadj export marker", marker_path.is_file(), str(marker_path))

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        report.add("sqlite: integrity_check", integrity == "ok", integrity)
        fk_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
        report.add("sqlite: foreign_key_check", not fk_rows, f"{len(fk_rows)} violations")
        user_version = conn.execute("PRAGMA user_version").fetchone()[0]
        report.add(
            "sqlite: user_version",
            user_version == USER_VERSION,
            str(user_version),
        )

        report.add(
            "schema: matches packaged 3.0.1 DDL",
            _normalized_ddl(conn) == _reference_ddl(),
        )

        info = conn.execute(
            "SELECT uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch "
            "FROM Information"
        ).fetchall()
        info_ok = (
            len(info) == 1 and bool(info[0][0]) and tuple(info[0][1:]) == (3, 0, 1)
        )
        report.add("information: single 3.0.1 row with uuid", info_ok, repr(info))
        library_uuid = info[0][0] if info else None

        # Freshness / self-containment.
        origin_uuids = {
            row[0]
            for row in conn.execute("SELECT DISTINCT originDatabaseUuid FROM Track")
        }
        entity_uuids = {
            row[0]
            for row in conn.execute("SELECT DISTINCT databaseUuid FROM PlaylistEntity")
        }
        foreign = (origin_uuids | entity_uuids) - {library_uuid}
        report.add(
            "freshness: single library uuid everywhere",
            not foreign,
            f"foreign uuids: {sorted(foreign)}" if foreign else "",
        )
        self_origin = conn.execute(
            "SELECT count(*) FROM Track WHERE originTrackId != id"
        ).fetchone()[0]
        report.add(
            "freshness: self-referential originTrackId", self_origin == 0, str(self_origin)
        )

        # Track paths: relative, portable, existing, contained.
        bad_paths: list[str] = []
        missing: list[str] = []
        escapes: list[str] = []
        size_mismatch: list[str] = []
        rows = conn.execute("SELECT id, path, fileBytes FROM Track").fetchall()
        for track_id, path, file_bytes in rows:
            if not path or path.startswith("/") or "/../" in path[3:]:
                bad_paths.append(f"{track_id}:{path}")
                continue
            resolved = (library_dir / path).resolve()
            if dest != resolved and dest not in resolved.parents:
                escapes.append(f"{track_id}:{path}")
                continue
            if not resolved.is_file():
                missing.append(f"{track_id}:{path}")
                continue
            if file_bytes is not None and resolved.stat().st_size != file_bytes:
                size_mismatch.append(f"{track_id}:{path}")
        report.add("tracks: portable relative paths", not bad_paths, "; ".join(bad_paths[:5]))
        report.add("tracks: paths contained in device root", not escapes, "; ".join(escapes[:5]))
        report.add("tracks: audio files exist", not missing, "; ".join(missing[:5]))
        report.add(
            "tracks: fileBytes matches audio size", not size_mismatch, "; ".join(size_mismatch[:5])
        )

        art_orphans = conn.execute(
            "SELECT count(*) FROM Track t LEFT JOIN AlbumArt a ON a.id = t.albumArtId "
            "WHERE t.albumArtId IS NULL OR a.id IS NULL"
        ).fetchone()[0]
        report.add("tracks: albumArtId resolves", art_orphans == 0, str(art_orphans))

        perf_missing = conn.execute(
            "SELECT count(*) FROM Track t LEFT JOIN PerformanceData p ON p.trackId = t.id "
            "WHERE p.trackId IS NULL"
        ).fetchone()[0]
        report.add("tracks: PerformanceData row per track", perf_missing == 0, str(perf_missing))

        # Blob decodability.
        blob_errors: list[str] = []
        analyzed_partial: list[str] = []
        for track_id, is_analyzed, beat, quick, track_data, overview, loops in conn.execute(
            "SELECT t.id, t.isAnalyzed, p.beatData, p.quickCues, p.trackData, "
            "p.overviewWaveFormData, p.loops FROM Track t "
            "JOIN PerformanceData p ON p.trackId = t.id"
        ):
            try:
                if beat:
                    parse_beat_data(beat)
                if quick:
                    parse_quick_cues(quick)
                if track_data:
                    parse_track_data(track_data)
                if overview:
                    _check_overview(overview)
                if loops:
                    _parse_loops_raw(loops)
            except (BlobParseError, struct.error, IndexError) as error:
                blob_errors.append(f"{track_id}: {error}")
            if is_analyzed and not all((beat, quick, track_data, overview)):
                analyzed_partial.append(str(track_id))
        report.add("blobs: all decode", not blob_errors, "; ".join(blob_errors[:5]))
        report.add(
            "blobs: analyzed rows carry full sets",
            not analyzed_partial,
            "; ".join(analyzed_partial[:5]),
        )

        # Linked lists: sibling chains per parent, entity chains per list.
        sibling_ok = True
        for (parent,) in conn.execute("SELECT DISTINCT parentListId FROM Playlist"):
            rows = conn.execute(
                "SELECT id, nextListId FROM Playlist WHERE parentListId = ?", (parent,)
            ).fetchall()
            if _walk_linked_list(rows) is None:
                sibling_ok = False
        report.add("playlists: sibling linked list intact", sibling_ok)
        entity_ok = True
        for (list_id,) in conn.execute("SELECT id FROM Playlist"):
            rows = conn.execute(
                "SELECT id, nextEntityId FROM PlaylistEntity WHERE listId = ?", (list_id,)
            ).fetchall()
            if _walk_linked_list(rows) is None:
                entity_ok = False
        report.add("playlists: entity linked lists intact", entity_ok)

        if manadj_session is not None:
            _verify_projection(conn, manadj_session, report)
    finally:
        conn.close()
    return report


def _device_track_order(conn: sqlite3.Connection, list_id: int) -> list[int]:
    rows = conn.execute(
        "SELECT id, nextEntityId FROM PlaylistEntity WHERE listId = ?", (list_id,)
    ).fetchall()
    order = _walk_linked_list(rows) or []
    track_of = dict(
        conn.execute(
            "SELECT id, trackId FROM PlaylistEntity WHERE listId = ?", (list_id,)
        ).fetchall()
    )
    return [track_of[entity_id] for entity_id in order]


def _verify_projection(
    conn: sqlite3.Connection, manadj_session: Session, report: VerifyReport
) -> None:
    """Exact source projection: order, cues, main cue, grid, key, rating."""
    from backend.models import HotCue, Playlist as ManAdjPlaylist, PlaylistTrack
    from backend.models import Track as ManAdjTrack
    from .device_export import _tempo_changes
    from .perf_export import _grid_markers
    from .ratings import energy_to_rating

    # manadj id from the export layout ("../<audio>/<manadj-id>/<name>").
    manadj_of: dict[int, int] = {}
    for track_id, path in conn.execute("SELECT id, path FROM Track"):
        prefix = Path(path).parent.name
        if prefix.isdigit():
            manadj_of[track_id] = int(prefix)

    # Playlist order.
    order_errors: list[str] = []
    device_lists = {
        title: list_id
        for list_id, title in conn.execute("SELECT id, title FROM Playlist")
    }
    for mplaylist in manadj_session.query(ManAdjPlaylist).all():
        list_id = device_lists.get(mplaylist.name)
        if list_id is None:
            order_errors.append(f"missing playlist {mplaylist.name!r}")
            continue
        device_order = [
            manadj_of.get(track_id) for track_id in _device_track_order(conn, list_id)
        ]
        entries = (
            manadj_session.query(PlaylistTrack)
            .filter(PlaylistTrack.playlist_id == mplaylist.id)
            .order_by(PlaylistTrack.position)
            .all()
        )
        exported = set(manadj_of.values())
        expected = [e.track_id for e in entries if e.track_id in exported]
        if device_order != expected:
            order_errors.append(
                f"{mplaylist.name!r}: device {device_order} != source {expected}"
            )
    report.add("projection: exact playlist order", not order_errors, "; ".join(order_errors[:3]))

    # Per-track cue/grid/key/rating projection.
    cue_errors: list[str] = []
    grid_errors: list[str] = []
    field_errors: list[str] = []
    rows = conn.execute(
        "SELECT t.id, t.key, t.rating, p.beatData, p.quickCues FROM Track t "
        "JOIN PerformanceData p ON p.trackId = t.id"
    ).fetchall()
    for track_id, key, rating, beat_blob, quick_blob in rows:
        manadj_id = manadj_of.get(track_id)
        if manadj_id is None:
            continue
        mtrack = manadj_session.get(ManAdjTrack, manadj_id)
        if mtrack is None:
            continue

        if mtrack.key is not None and key != mtrack.key:
            field_errors.append(f"{manadj_id}: key {key} != {mtrack.key}")
        if mtrack.energy is not None and rating != energy_to_rating(mtrack.energy):
            field_errors.append(f"{manadj_id}: rating {rating}")

        sample_rate = None
        if beat_blob:
            sample_rate = parse_beat_data(beat_blob).sample_rate

        manadj_cues = (
            manadj_session.query(HotCue).filter(HotCue.track_id == manadj_id).all()
        )
        if manadj_cues or mtrack.cue_point_time is not None:
            if not quick_blob or sample_rate is None:
                cue_errors.append(f"{manadj_id}: cues present in source, no decodable quickCues")
            else:
                quick = parse_quick_cues(quick_blob)
                by_slot = {cue.slot: cue for cue in quick.hot_cues}
                for cue in manadj_cues:
                    device_cue = by_slot.get(cue.slot_number - 1)
                    if device_cue is None:
                        cue_errors.append(f"{manadj_id}: slot {cue.slot_number} missing")
                        continue
                    seconds = device_cue.sample_offset / sample_rate
                    if abs(seconds - cue.time_seconds) > CUE_TOLERANCE_SECS:
                        cue_errors.append(
                            f"{manadj_id}: slot {cue.slot_number} at {seconds}, "
                            f"source {cue.time_seconds}"
                        )
                if mtrack.cue_point_time is not None:
                    seconds = quick.main_cue_samples / sample_rate
                    if abs(seconds - mtrack.cue_point_time) > CUE_TOLERANCE_SECS:
                        cue_errors.append(f"{manadj_id}: main cue at {seconds}")

        changes = _tempo_changes(mtrack)
        if changes:
            if not beat_blob:
                grid_errors.append(f"{manadj_id}: source grid, no beatData")
            else:
                beat = parse_beat_data(beat_blob)
                waveform = mtrack.waveform
                duration = (
                    waveform.duration if waveform is not None else mtrack.duration_secs
                )
                if duration is None:
                    duration = beat.track_length_samples / beat.sample_rate
                expected = _grid_markers(changes, beat.sample_rate, duration)
                actual = beat.adjusted_grid
                if len(actual) != len(expected):
                    grid_errors.append(
                        f"{manadj_id}: {len(actual)} markers, expected {len(expected)}"
                    )
                else:
                    for exp, act in zip(expected, actual):
                        if (
                            abs(exp.sample_offset - act.sample_offset)
                            > GRID_TOLERANCE_SAMPLES
                            or exp.beat_index != act.beat_index
                        ):
                            grid_errors.append(f"{manadj_id}: marker drift")
                            break

    report.add("projection: hot cues + main cue exact", not cue_errors, "; ".join(cue_errors[:3]))
    report.add("projection: beatgrid exact", not grid_errors, "; ".join(grid_errors[:3]))
    report.add("projection: key/rating mapping", not field_errors, "; ".join(field_errors[:3]))

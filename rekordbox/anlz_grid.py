"""Rekordbox beatgrid (ANLZ PQTZ) — read, reduce, generate, author.

The grid lives ONLY in the ANLZ `.DAT` `PQTZ` tag (never the DB): an
explicit per-beat array of `(beat-in-bar u16, BPM×100 u16, time-ms u32)`.
manadj stores segments (tempo_changes); the two directions here are
inverses:

    reduce_beats:   per-beat array  -> tempo_change segments (read side)
    generate_beats: segments        -> per-beat array        (write side)

Authoring recipe from the spike (docs/research/rekordbox-performance-
write.md): rebuild the construct containers and fix `len_tag = 24 + 8n`
by hand — pyrekordbox's per-tag `update_len` is a no-op; `AnlzFile.
build()` validates the total length, and RB7 renders authored grids
(variable grids beat-jump correctly).

All positions cross the manadj/RB frame boundary via decode_offset.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.sync_status.models import BeatgridValue, TempoChangeValue

logger = logging.getLogger(__name__)

BPM_RUN_TOLERANCE = 0.005  # PQTZ tempo is u16 BPM×100: exact runs expected

# (path, mtime) -> BeatgridValue | None (RB frame); sync status reads whole
# libraries per request and ANLZ parsing isn't free.
_read_cache: dict[tuple[str, float], BeatgridValue | None] = {}


def read_pqtz(dat_path: str | Path) -> BeatgridValue | None:
    """The PQTZ grid of an ANLZ .DAT as tempo_changes, in RB's frame.
    None when the file/tag is missing or unparseable (surface carries no
    grid — not a divergence)."""
    p = Path(dat_path)
    try:
        key = (str(p), p.stat().st_mtime)
    except OSError:
        return None
    if key in _read_cache:
        return _read_cache[key]
    try:
        from pyrekordbox.anlz import AnlzFile

        dat = AnlzFile.parse_file(str(p))
        tags = dat.getall_tags("PQTZ")
        beats = (
            [
                (int(e.beat), e.tempo / 100.0, e.time / 1000.0)
                for e in tags[0].struct.content.entries
            ]
            if tags
            else []
        )
        result = reduce_beats(beats)
    except Exception as e:  # noqa: BLE001 - never let one bad file break sync
        logger.warning("anlz_grid: could not read %s: %s", p, e)
        result = None
    _read_cache[key] = result
    return result


def pqtz_extent_s(dat_path: str | Path) -> float | None:
    """Time of the LAST BEAT in the .DAT's PQTZ (RB frame) — the grid's
    extent. Distinct from reduce_beats' segments, whose last start_time
    is a tempo-run boundary, not the end of the grid."""
    try:
        from pyrekordbox.anlz import AnlzFile

        dat = AnlzFile.parse_file(str(Path(dat_path)))
        tags = dat.getall_tags("PQTZ")
        entries = tags[0].struct.content.entries if tags else []
        return entries[-1].time / 1000.0 if entries else None
    except Exception:  # noqa: BLE001
        return None


def reduce_beats(
    beats: list[tuple[int, float, float]],  # (beat_in_bar, bpm, time_s)
) -> BeatgridValue | None:
    """Per-beat array -> segments: one tempo change per run of equal BPM,
    anchored at the run's first beat (its bar phase preserved)."""
    if not beats:
        return None
    changes: list[TempoChangeValue] = []
    for beat_no, bpm, time_s in beats:
        if not changes or abs(changes[-1].bpm - bpm) > BPM_RUN_TOLERANCE:
            changes.append(
                TempoChangeValue(start_time=time_s, bpm=bpm, bar_position=beat_no)
            )
    return BeatgridValue(tempo_changes=changes)


def generate_beats(
    tempo_changes: list[TempoChangeValue],
    end_s: float,
    beats_per_bar: int = 4,
) -> list[tuple[int, float, float]]:
    """Segments -> per-beat array (the exact inverse of reduce_beats):
    each segment walks beats at its BPM from its start time, bar phase
    starting at its bar_position, until the next segment (or end_s)."""
    out: list[tuple[int, float, float]] = []
    for i, tc in enumerate(tempo_changes):
        seg_end = tempo_changes[i + 1].start_time if i + 1 < len(tempo_changes) else end_s
        period = 60.0 / tc.bpm
        t = tc.start_time
        beat = tc.bar_position
        while t < seg_end - 1e-9:
            out.append((beat, tc.bpm, t))
            beat = beat % beats_per_bar + 1
            t += period
    return out


def write_pqtz(dat_path: str | Path, beats: list[tuple[int, float, float]]) -> int:
    """Author the .DAT's PQTZ from a per-beat array (RB frame). Returns
    the entry count written. Raises when the file or tag is absent — we
    never create ANLZ files from scratch (RB owns the other tags)."""
    from construct import Container
    from pyrekordbox.anlz import AnlzFile

    p = Path(dat_path)
    dat = AnlzFile.parse_file(str(p))
    tags = dat.getall_tags("PQTZ")
    if not tags:
        raise LookupError(f"no PQTZ tag in {p.name} — track not analyzed?")
    tag = tags[0]
    tag.struct.content.entries = [
        Container(beat=b, tempo=int(round(bpm * 100)), time=int(round(t * 1000)))
        for b, bpm, t in beats
    ]
    tag.struct.content.entry_count = len(beats)
    tag.struct.len_tag = tag.LEN_HEADER + 8 * len(beats)
    data = dat.build()  # validates total file length
    p.write_bytes(data)
    _read_cache.clear()
    logger.info("authored PQTZ: %d beats -> %s", len(beats), p)
    return len(beats)

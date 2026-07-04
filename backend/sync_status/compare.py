"""Field-value comparison semantics shared by the aggregator and the
performance-data import paths. Tolerances are tunable constants.

Cue positions compared across Surfaces come from different encodings
(Engine: samples at the blob's rate; manadj: seconds) — call them equal
within a millisecond. Main cue and beatgrid offsets share the tolerance.
"""

import json

from backend import models

from .models import BeatgridValue, HotCueValue, TempoChangeValue

CUE_TIME_TOLERANCE = 0.001
BEATGRID_BPM_TOLERANCE = 0.01


def hotcue_sets_equal(a: list[HotCueValue], b: list[HotCueValue]) -> bool:
    """Whole-set equality: same slots, and per slot the time agrees within
    tolerance, label agrees (None-normalized), color agrees (case folded)."""
    by_slot_a = {c.slot: c for c in a}
    by_slot_b = {c.slot: c for c in b}
    if by_slot_a.keys() != by_slot_b.keys():
        return False
    for slot, cue_a in by_slot_a.items():
        cue_b = by_slot_b[slot]
        if abs(cue_a.time - cue_b.time) > CUE_TIME_TOLERANCE:
            return False
        if (cue_a.label or None) != (cue_b.label or None):
            return False
        if (cue_a.color or "").upper() != (cue_b.color or "").upper():
            return False
    return True


def beatgrids_equal(a: BeatgridValue | None, b: BeatgridValue) -> bool:
    """Structural equality: same tempo-change count, each change agreeing on
    start time (cue tolerance), BPM (epsilon), and bar position."""
    if a is None:
        return False
    if len(a.tempo_changes) != len(b.tempo_changes):
        return False
    for tc_a, tc_b in zip(a.tempo_changes, b.tempo_changes):
        if abs(tc_a.start_time - tc_b.start_time) > CUE_TIME_TOLERANCE:
            return False
        if abs(tc_a.bpm - tc_b.bpm) > BEATGRID_BPM_TOLERANCE:
            return False
        if tc_a.bar_position != tc_b.bar_position:
            return False
    return True


def maincues_equal(a: float, b: float) -> bool:
    return abs(a - b) <= CUE_TIME_TOLERANCE


def hotcue_values_from_rows(rows: list[models.HotCue]) -> list[HotCueValue]:
    """Library HotCue rows as interface values (normalized like any Surface)."""
    return [
        HotCueValue(
            slot=hc.slot_number,
            time=hc.time_seconds,
            label=hc.label or None,
            color=hc.color.upper() if hc.color else None,
        )
        for hc in sorted(rows, key=lambda hc: hc.slot_number)
    ]


def beatgrid_value_from_row(grid: models.Beatgrid | None) -> BeatgridValue | None:
    """The Library's saved grid — a generated placeholder is not saved info
    (glossary: "placeholder grid") and reads as absent."""
    if grid is None or grid.origin == "generated":
        return None
    changes = json.loads(grid.tempo_changes_json)
    return BeatgridValue(
        tempo_changes=[
            TempoChangeValue(
                start_time=tc["start_time"],
                bpm=tc["bpm"],
                bar_position=tc.get("bar_position", 1),
            )
            for tc in changes
        ]
    )

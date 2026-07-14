"""Atomic Drop-anchor ORM mutations; callers own commit/rollback."""

import json

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import crud, models
from .beatgrid_utils import calculate_beats_from_tempo_changes


SOFT_RUNG_BARS = {1: 32, 2: 16, 3: 8}


def apply_drop_anchor(
    db: Session,
    track_id: int,
    drop_time: float,
    tempo_changes: list[dict],
    duration: float,
) -> tuple[models.Beatgrid, models.MetricLadder, list[models.HotCue]]:
    """Mutate the grid, ladder, and cue ladder without committing."""
    beatgrid = crud.get_beatgrid(db, track_id)
    if beatgrid:
        beatgrid.tempo_changes_json = json.dumps(tempo_changes)
        beatgrid.origin = "edited"
        beatgrid.anchor_time = drop_time
        beatgrid.updated_at = func.now()
    else:
        beatgrid = models.Beatgrid(
            track_id=track_id,
            tempo_changes_json=json.dumps(tempo_changes),
            origin="edited",
            anchor_time=drop_time,
        )
        db.add(beatgrid)

    ladder = crud.get_metric_ladder(db, track_id)
    if ladder:
        marks = json.loads(ladder.reset_marks_json)
        ladder.reset_marks_json = json.dumps(sorted(set([*marks, float(drop_time)])))
        ladder.updated_at = func.now()
    else:
        ladder = models.MetricLadder(
            track_id=track_id,
            arities_json=json.dumps(crud.DEFAULT_LADDER_ARITIES),
            reset_marks_json=json.dumps([float(drop_time)]),
        )
        db.add(ladder)

    cues = {cue.slot_number: cue for cue in crud.get_hotcues(db, track_id)}
    cue4 = cues.get(4)
    if cue4:
        cue4.time_seconds = drop_time
    else:
        cue4 = models.HotCue(track_id=track_id, slot_number=4, time_seconds=drop_time)
        db.add(cue4)
        cues[4] = cue4

    # The rebuilt grid contains the playhead-exact drop as a downbeat. Walk
    # its downbeat lattice backward by bars; occupied soft slots never move.
    downbeats = calculate_beats_from_tempo_changes(tempo_changes, duration)[1]
    drop_ordinal = min(range(len(downbeats)), key=lambda i: abs(downbeats[i] - drop_time))
    for slot, bars_before in SOFT_RUNG_BARS.items():
        if slot in cues:
            continue
        ordinal = drop_ordinal - bars_before
        if ordinal < 0 or downbeats[ordinal] < 0:
            continue
        cue = models.HotCue(
            track_id=track_id,
            slot_number=slot,
            time_seconds=downbeats[ordinal],
        )
        db.add(cue)
        cues[slot] = cue

    return beatgrid, ladder, [cues[slot] for slot in sorted(cues)]

"""Applying performance-data imports to the Library.

Writes rows directly — Engine positions are ground truth, stored exactly
as-is. (No longer a special case: since looping 01 the whole API stores
positions verbatim; Quantize snapping happens client-side at gesture time.)
"fill-empty" never touches saved info; the replace verbs are the confirmed
overwrites.
"""

from typing import Literal

from sqlalchemy.orm import Session

from backend import crud, models
from backend.beatgrid_utils import dominant_bpm
from backend.sync_status.models import BeatgridValue, HotCueValue
from backend.track_metadata.units import bpm_to_centibpm

HotCueImportMode = Literal["fill-empty", "replace-all"]
SingleValueImportMode = Literal["fill-empty", "replace"]


def import_hotcues(
    db: Session,
    track_id: int,
    cues: list[HotCueValue],
    mode: HotCueImportMode,
) -> dict[str, int]:
    """Import Engine hot cues onto a Library track.

    fill-empty: only slots the Library doesn't have; never touches existing.
    replace-all: the confirmed overwrite verb — Library set is deleted and
    Engine's set written wholesale.
    """
    existing = db.query(models.HotCue).filter(models.HotCue.track_id == track_id).all()
    occupied = {hc.slot_number for hc in existing}

    deleted = 0
    if mode == "replace-all":
        for hc in existing:
            db.delete(hc)
            deleted += 1
        occupied = set()
        db.flush()  # deletes must land before re-inserting the same slots

    imported = 0
    skipped = 0
    for cue in cues:
        if cue.slot in occupied:
            skipped += 1
            continue
        db.add(
            models.HotCue(
                track_id=track_id,
                slot_number=cue.slot,
                time_seconds=cue.time,  # exact — no beat quantization
                label=cue.label,
                color=cue.color,
            )
        )
        imported += 1

    db.commit()
    return {"imported": imported, "skipped": skipped, "deleted": deleted}


def import_beatgrid(
    db: Session,
    track_id: int,
    beatgrid: BeatgridValue,
    mode: SingleValueImportMode,
) -> dict[str, bool | str | None]:
    """Import Engine's Beatgrid onto a Library track (origin "imported").

    fill-empty: only when the Library grid is absent or a generated
    placeholder. replace: the confirmed overwrite verb.
    """
    existing = crud.get_beatgrid(db, track_id)
    if mode == "fill-empty" and existing is not None and existing.origin != "generated":
        return {"imported": False, "reason": "saved grid present"}

    tempo_changes = [
        {
            "start_time": tc.start_time,
            "bpm": tc.bpm,
            "time_signature_num": 4,
            "time_signature_den": 4,
            "bar_position": tc.bar_position,
        }
        for tc in beatgrid.tempo_changes
    ]
    # Imported grid replaces the local one wholesale: any prior mark refers
    # to a grid that no longer exists — clear the anchor (ADR 0016)
    crud.update_beatgrid_tempo_changes(
        db, track_id, tempo_changes, origin="imported", anchor_time=None
    )

    # BPM is a projection of the Beatgrid (ADR 0016): write the imported
    # grid's dominant tempo through to the tracks.bpm cache
    track = crud.get_track(db, track_id)
    if track is not None and tempo_changes:
        waveform = crud.get_waveform(db, track_id)
        duration = waveform.duration if waveform else None
        track.bpm = bpm_to_centibpm(dominant_bpm(tempo_changes, duration))
        db.commit()

    return {"imported": True, "reason": None}


def import_maincue(
    db: Session,
    track_id: int,
    maincue: float,
    mode: SingleValueImportMode,
) -> dict[str, bool | str | None]:
    """Import Engine's user-set Main cue onto a Library track, through the
    normal persistence home (the Track's cue point) so an imported cue
    behaves exactly like one set on a Deck.

    Raises ValueError when the track does not exist.
    """
    track = crud.get_track(db, track_id)
    if track is None:
        raise ValueError("Track not found; the Main cue has nowhere to live")
    if mode == "fill-empty" and track.cue_point_time is not None:
        return {"imported": False, "reason": "saved main cue present"}

    track.cue_point_time = maincue
    db.commit()
    return {"imported": True, "reason": None}

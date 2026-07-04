"""Applying performance-data imports to the Library.

Writes HotCue rows directly — Engine positions are ground truth, so the
set-cue beat-quantization path is deliberately bypassed (PRD).
"""

from typing import Literal

from sqlalchemy.orm import Session

from backend import models
from backend.sync_status.models import HotCueValue

HotCueImportMode = Literal["fill-empty", "replace-all"]


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

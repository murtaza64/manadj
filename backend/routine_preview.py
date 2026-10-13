"""Promotion PREVIEW (#205, ADR 0037 draft-everywhere): run the mechanical
promotion pipeline (deck→slot re-addressing + beat-domain rebase) over a
Session slice WITHOUT persisting anything — no Routine row, no take
mutation. The Mix editor opens unpromoted Routine Takes and miner
candidates as review drafts through this; Promote stays the explicit
persisting act (reverses #170's promote-on-open).

The loader half of routers/routine_takes.promote_routine_take, extracted
so takes and candidates share it. Raises PreviewError with a
human-readable message; routers map it to 422.
"""

import json

from sqlalchemy.orm import Session

from backend import models
from backend.beatgrid_utils import constant_tempo_changes
from backend.routine_promotion import PromotedRoutine, PromotionError, promote


class PreviewError(Exception):
    """Preview inputs unreadable (session gone, gridless cast, or the
    promotion itself failed)."""


def build_promotion_preview(
    db: Session,
    session_uuid: str,
    cast: list[int],
    window_start_s: float,
    window_end_s: float,
    entry_offsets: list[float],
) -> PromotedRoutine:
    """Load the Session slice + cast grids and run the pure promotion.

    Identical inputs to the persisting promote route — a later Promote of
    the same take yields byte-identical geometry, so review-draft edits
    transfer 1:1 onto the minted Routine.
    """
    s = db.query(models.Session).filter(models.Session.uuid == session_uuid).first()
    if s is None:
        raise PreviewError(
            "the take's Session is gone — its event slice reference cannot be read"
        )
    events: list[dict] = []
    for chunk in s.chunks:
        events.extend(json.loads(chunk.events_json))

    grids: dict[int, list[dict]] = {}
    for tid in cast:
        bg = db.query(models.Beatgrid).filter(models.Beatgrid.track_id == tid).first()
        if bg is not None:
            grids[tid] = json.loads(bg.tempo_changes_json)
            continue
        # Gridless track: constant grid from the served BPM (ADR 0027 —
        # the same placeholder posture as GET /api/beatgrids/{id}).
        track = db.query(models.Track).filter(models.Track.id == tid).first()
        bpm = track.bpm_projected if track is not None else None
        if bpm is None or bpm <= 0:
            raise PreviewError(f"cast track {tid} has no beatgrid or BPM")
        grids[tid] = constant_tempo_changes(bpm)

    try:
        return promote(events, cast, window_start_s, window_end_s, entry_offsets, grids)
    except PromotionError as e:
        raise PreviewError(str(e)) from e

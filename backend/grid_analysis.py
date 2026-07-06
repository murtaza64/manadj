"""Native grid Analysis: audio in, analyzed Beatgrid (or bail) out.

ADR 0024: the analyzer's output artifact is a Beatgrid with origin
"analyzed", produced by the constant fit over beat-tracker ticks behind the
GridAnalyzer seam the shootout harness scored. BPM is that grid's projection
(ADR 0016), written through to the tracks.bpm cache — no independent
integer-snapped BPM writes. On bail nothing is written except diagnostics
(GridAnalysis, one row per Track, overwritten per run); a bailed Track with
no saved grid is the needs-attention worklist (Track.needs_attention).

Heavy deps (madmom) stay inside the candidate's ticks() — importing this
module is light (import-hygiene guard).
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from harness.analyzer import GridAnalyzer
from harness.fit import GridFit
from harness.grid_candidates import MadmomDBN

from . import models
from .beatgrid_utils import constant_tempo_changes
from .crud import update_beatgrid_tempo_changes
from .track_metadata.units import bpm_to_centibpm


def default_grid_analyzer() -> GridAnalyzer:
    """The shootout winner (native-analysis-accuracy 06): madmom RNN+DBN
    beat tracking with the fit's default parameters."""
    return GridAnalyzer(MadmomDBN())


def get_grid_analysis(db: Session, track_id: int) -> models.GridAnalysis | None:
    """Stored diagnostics of the last analysis run, if any."""
    return (
        db.query(models.GridAnalysis)
        .filter(models.GridAnalysis.track_id == track_id)
        .first()
    )


def analyze_track_grid(
    db: Session, track: models.Track, analyzer: GridAnalyzer
) -> models.GridAnalysis:
    """Analyze one Track and persist the outcome.

    Success: constant Beatgrid (origin "analyzed", anchor cleared — any prior
    mark refers to a grid that no longer exists) + BPM projection to the
    cache. Bail: diagnostics only; whatever grid/BPM the Track already has
    stays untouched. Precedence protection is the bulk runner's concern
    (issue 09) — this seam overwrites freely.
    """
    fit = analyzer.analyze(track.filename)
    diagnostics = _overwrite_diagnostics(db, track.id, analyzer.name, fit)

    if not fit.bailed:
        assert fit.bpm is not None and fit.phase is not None
        tempo_changes = constant_tempo_changes(fit.bpm, start_time=fit.phase)
        update_beatgrid_tempo_changes(
            db, track.id, tempo_changes, origin="analyzed", anchor_time=None
        )
        # BPM is a projection of the Beatgrid (ADR 0016): write the grid's
        # tempo through to the tracks.bpm cache.
        track.bpm = bpm_to_centibpm(fit.bpm)

    db.commit()
    db.refresh(diagnostics)
    return diagnostics


def _overwrite_diagnostics(
    db: Session, track_id: int, candidate: str, fit: GridFit
) -> models.GridAnalysis:
    diagnostics = get_grid_analysis(db, track_id)
    if diagnostics is None:
        diagnostics = models.GridAnalysis(track_id=track_id)
        db.add(diagnostics)
    diagnostics.candidate = candidate
    diagnostics.bailed = fit.bailed
    diagnostics.bpm = fit.bpm
    diagnostics.phase = fit.phase
    diagnostics.residual_ms = fit.residual_ms
    diagnostics.evidence_json = json.dumps(fit.evidence)
    diagnostics.updated_at = func.now()
    return diagnostics

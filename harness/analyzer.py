"""The candidate analyzer seam (ADR 0024): audio in -> GridFit out.

This is the interface the app will consume in Phase B — a grid analyzer is
a beat tracker (Stage 1, ticks) composed with the shared constant fit
(Stage 2). The harness scores analyzers through this same seam.
"""

from __future__ import annotations

from dataclasses import dataclass

from harness.fit import FitParams, GridFit, fit_constant_grid
from harness.grid_candidates import GridCandidate


@dataclass(frozen=True)
class GridAnalyzer:
    """A complete grid analysis pipeline: ticks are evidence, the constant
    fit produces the grid — or bails (Quantized-track assumption)."""

    candidate: GridCandidate
    params: FitParams | None = None

    @property
    def name(self) -> str:
        return self.candidate.name

    def analyze(self, audio_path: str) -> GridFit:
        params = self.params if self.params is not None else self.candidate.fit_params
        return fit_constant_grid(self.candidate.ticks(audio_path), params)

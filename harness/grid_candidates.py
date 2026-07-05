"""Grid candidates: beat trackers producing ticks (Stage 1 of the pipeline).

Every candidate implements the same contract — audio path in, tick times
(seconds) out — and heavy deps are imported inside methods only, never at
module top-level (import-hygiene guard).
"""

from __future__ import annotations

from typing import Protocol

from harness.fit import FitParams


class GridCandidate(Protocol):
    """A beat tracker. Ticks are evidence for the constant fit, never the
    grid. `fit_params` lets a candidate adapt the shared fit to its output
    characteristics (e.g. frame quantization) — the analyzer under test is
    always tracker + fit together."""

    name: str
    fit_params: FitParams

    def ticks(self, audio_path: str) -> list[float]: ...


class EssentiaRhythm2013(GridCandidate):
    """Baseline: Essentia RhythmExtractor2013 (multifeature), ticks kept
    (the current app path throws them away and keeps only the BPM)."""

    name = "essentia_rhythm2013"
    fit_params = FitParams()

    def ticks(self, audio_path: str) -> list[float]:
        import essentia.standard as es  # heavy: candidates only

        audio = es.MonoLoader(filename=audio_path, sampleRate=44100)()
        extractor = es.RhythmExtractor2013(method="multifeature")
        _bpm, beats, _conf, _est, _intervals = extractor(audio)
        return [float(t) for t in beats]





class MadmomDBN(GridCandidate):
    """madmom RNN beat activation + DBN tracking — the long-standing
    accuracy leader in MIREX-style beat evals."""

    name = "madmom_dbn"
    fit_params = FitParams()

    def ticks(self, audio_path: str) -> list[float]:
        from madmom.features.beats import (  # heavy: candidates only
            DBNBeatTrackingProcessor,
            RNNBeatProcessor,
        )

        activations = RNNBeatProcessor()(audio_path)
        beats = DBNBeatTrackingProcessor(fps=100)(activations)
        return [float(t) for t in beats]





class BeatThis(GridCandidate):
    """beat_this (CPJKU, 2024 transformer) — current beat-tracking SOTA.
    Emits 50fps frame-quantized beats; the fit's region tolerance accounts
    for the resulting interval wobble."""

    name = "beat_this"
    # 50fps beats = up to ~6% interval wobble at 175 BPM; regions need the
    # wider gate to form at all. The conform gate still protects.
    fit_params = FitParams(region_tolerance=0.10)

    def ticks(self, audio_path: str) -> list[float]:
        from beat_this.inference import File2Beats  # heavy: candidates only

        beats, _downbeats = File2Beats(
            checkpoint_path="final0", device="cpu", dbn=False
        )(audio_path)
        return [float(t) for t in beats]


GRID_CANDIDATES: dict[str, GridCandidate] = {
    c.name: c for c in (EssentiaRhythm2013(), MadmomDBN(), BeatThis())
}

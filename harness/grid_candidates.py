"""Grid candidates: beat trackers producing ticks (Stage 1 of the pipeline).

Every candidate implements the same contract — audio path in, tick times
(seconds) out — and heavy deps are imported inside methods only, never at
module top-level (import-hygiene guard).
"""

from __future__ import annotations

from typing import Protocol


class GridCandidate(Protocol):
    """A beat tracker. Ticks are evidence for the constant fit, never the grid."""

    name: str

    def ticks(self, audio_path: str) -> list[float]: ...


class EssentiaRhythm2013(GridCandidate):
    """Baseline: Essentia RhythmExtractor2013 (multifeature), ticks kept
    (the current app path throws them away and keeps only the BPM)."""

    name = "essentia_rhythm2013"

    def ticks(self, audio_path: str) -> list[float]:
        import essentia.standard as es  # heavy: candidates only

        audio = es.MonoLoader(filename=audio_path, sampleRate=44100)()
        extractor = es.RhythmExtractor2013(method="multifeature")
        _bpm, beats, _conf, _est, _intervals = extractor(audio)
        return [float(t) for t in beats]


GRID_CANDIDATES: dict[str, GridCandidate] = {
    EssentiaRhythm2013.name: EssentiaRhythm2013(),
}

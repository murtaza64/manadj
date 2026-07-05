"""Guard: the test suite must not import the heavy analysis stack."""

import sys

HEAVY_MODULES = ("essentia", "tensorflow", "madmom", "librosa", "beatnet", "torch", "torchaudio", "beat_this")


def test_heavy_analysis_deps_not_imported() -> None:
    loaded = [m for m in HEAVY_MODULES if m in sys.modules]
    assert not loaded, f"heavy deps leaked into the test import chain: {loaded}"

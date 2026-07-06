"""Guard: the test suite must not load the heavy analysis stack.

Analysis deps (essentia, tensorflow, madmom, ...) take seconds to import and
are platform-fussy. Test-relevant modules must not pull them in. If this test
fails, some module in the test import chain grew an analysis import.
"""

import sys

HEAVY_MODULES = [
    "essentia", "tensorflow", "madmom", "beatnet", "librosa", "keras",
    "torch", "torchaudio", "beat_this",
]


def test_no_heavy_audio_deps_in_import_chain():
    # Import everything the suite legitimately touches.
    import backend.analysis_tasks  # noqa: F401
    import backend.beatgrid_utils  # noqa: F401
    import backend.bulk_analysis  # noqa: F401
    import backend.crud  # noqa: F401
    import backend.grid_analysis  # noqa: F401
    import backend.key  # noqa: F401
    import backend.key_analysis  # noqa: F401
    import backend.library.import_manager  # noqa: F401
    import backend.routers.analyze  # noqa: F401
    import backend.routers.tracks  # noqa: F401
    import backend.schemas  # noqa: F401
    import backend.track_metadata  # noqa: F401

    # Harness pure modules (fit/scoring/corpus) must stay light too, and
    # the candidate/analyzer seam the app now consumes (ADR 0024) keeps
    # heavy deps inside candidate methods.
    import harness.analyzer  # noqa: F401
    import harness.corpus  # noqa: F401
    import harness.fit  # noqa: F401
    import harness.grid_candidates  # noqa: F401
    import harness.grid_scoring  # noqa: F401
    import harness.key_candidates  # noqa: F401
    import harness.key_scoring  # noqa: F401

    loaded = [m for m in HEAVY_MODULES if m in sys.modules]
    assert not loaded, (
        f"Heavy analysis modules leaked into the test import chain: {loaded}. "
        "Find the new import and move it behind the Analysis seam."
    )

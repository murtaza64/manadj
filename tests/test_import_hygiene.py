"""Guard: the test suite must not load the heavy analysis stack.

Analysis deps (essentia, tensorflow, madmom, ...) take seconds to import and
are platform-fussy. Test-relevant modules must not pull them in. If this test
fails, some module in the test import chain grew an analysis import.
"""

import sys

HEAVY_MODULES = ["essentia", "tensorflow", "madmom", "beatnet", "librosa", "keras"]


def test_no_heavy_audio_deps_in_import_chain():
    # Import everything the suite legitimately touches.
    import backend.beatgrid_utils  # noqa: F401
    import backend.crud  # noqa: F401
    import backend.id3_utils  # noqa: F401
    import backend.key  # noqa: F401
    import backend.library.import_manager  # noqa: F401
    import backend.routers.tracks  # noqa: F401
    import backend.schemas  # noqa: F401

    loaded = [m for m in HEAVY_MODULES if m in sys.modules]
    assert not loaded, (
        f"Heavy analysis modules leaked into the test import chain: {loaded}. "
        "Find the new import and move it behind the Analysis seam."
    )

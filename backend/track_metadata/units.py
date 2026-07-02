"""Unit conversion for BPM.

The tracks.bpm column stores centiBPM (int, BPM x 100). That fact lives here
and in the ORM column only: every other interface — Python, HTTP, files —
carries BPM as a float. Convert exactly once, at this seam.
"""


def bpm_to_centibpm(bpm: float | None) -> int | None:
    """Convert float BPM to the centiBPM storage unit."""
    if bpm is None:
        return None
    return round(bpm * 100)


def centibpm_to_bpm(centibpm: int | None) -> float | None:
    """Convert the centiBPM storage unit to float BPM."""
    if centibpm is None:
        return None
    return centibpm / 100.0

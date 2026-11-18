"""Stage derivation (gh#342; simplified in gh#488/#489): pure functions."""

import pytest

from backend.acquisition.lifecycle import derive_stage


@pytest.mark.parametrize(
    ("state", "stage"),
    [
        ("new", "new"),
        ("fulfilled", "fulfilled"),
        ("ignored", "ignored"),
        # legacy pre-removal rows: "queued for download" now reads as wanted
        ("queued", "new"),
    ],
)
def test_derive_stage(state: str, stage: str) -> None:
    assert derive_stage(state) == stage
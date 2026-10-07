"""Stage + error-kind derivation (gh#342): pure functions."""

import pytest

from backend.acquisition.lifecycle import classify_error, derive_stage


@pytest.mark.parametrize(
    ("state", "task", "stage"),
    [
        ("new", None, "new"),
        ("queued", None, "queued"),
        ("queued", "pending", "queued"),
        ("queued", "running", "downloading"),
        ("queued", "failed", "failed"),
        ("queued", "done", "queued"),  # done task, item not yet flipped: still in flight
        ("fulfilled", "done", "fulfilled"),
        ("ignored", "failed", "ignored"),
    ],
)
def test_derive_stage(state: str, task: str | None, stage: str) -> None:
    assert derive_stage(state, task) == stage


@pytest.mark.parametrize(
    ("error", "via", "kind"),
    [
        (None, "soundcloud", None),
        ("ERROR: [soundcloud] 2389765131: This video is DRM protected", "soundcloud", "drm"),
        ("HTTP Error 429: Too Many Requests", "soundcloud", "ratelimit"),
        ("ERROR: [soundcloud] Unable to download JSON metadata: HTTP Error 404", "soundcloud", "gone"),
        ("soulseek download not completed within 24h of the pick ('x')", "soulseek", "peer"),
        ("soulseek transfer failed ('x')", "soulseek", "peer"),
        ("filename collision: Hoax - Wake Up.mp3 exists", "soundcloud", "other"),
    ],
)
def test_classify_error(error: str | None, via: str, kind: str | None) -> None:
    assert classify_error(error, via) == kind

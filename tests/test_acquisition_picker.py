"""Picker result shaping (soulseek-supplier issue 04): pure semantics over
canned search results — filtering, duration deltas, best-pick-first ordering.
"""

from backend.acquisition.picker import shape_results
from backend.acquisition.supplier import SupplierSearchResult

ITEM_DURATION_MS = 200_000


def result(
    token: str,
    format: str = "mp3",
    duration_ms: int | None = ITEM_DURATION_MS,
    bitrate_kbps: int | None = None,
    queue_length: int | None = 0,
    has_free_slot: bool | None = None,
) -> SupplierSearchResult:
    return SupplierSearchResult(
        download_token=token,
        filename=f"@@peer\\Music\\{token}.{format}",
        format=format,
        bitrate_kbps=bitrate_kbps,
        size_bytes=1_000_000,
        duration_ms=duration_ms,
        queue_length=queue_length,
        has_free_slot=has_free_slot,
    )


def order(shaped) -> list[str]:
    return [s.result.download_token for s in shaped]


class TestFiltering:
    def test_non_audio_junk_dropped(self) -> None:
        """Peers share whole directories: cover art and cue sheets come back
        from search and must never reach the picker."""
        shaped = shape_results(
            [result("song", "flac"), result("cover", "jpg"), result("rip", "cue"),
             result("notes", "nfo"), result("tune", "mp3")],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["song", "tune"]


class TestDelta:
    def test_delta_computed_per_candidate(self) -> None:
        shaped = shape_results(
            [result("long", duration_ms=ITEM_DURATION_MS + 12_000)], ITEM_DURATION_MS
        )
        assert shaped[0].duration_delta_ms == 12_000
        assert not shaped[0].exact_duration

    def test_unknown_duration_has_no_delta(self) -> None:
        shaped = shape_results([result("mystery", duration_ms=None)], ITEM_DURATION_MS)
        assert shaped[0].duration_delta_ms is None
        assert not shaped[0].exact_duration

    def test_within_tolerance_is_exact(self) -> None:
        shaped = shape_results(
            [result("close", duration_ms=ITEM_DURATION_MS - 2_000)], ITEM_DURATION_MS
        )
        assert shaped[0].exact_duration


class TestOrdering:
    def test_exact_lossless_first(self) -> None:
        shaped = shape_results(
            [
                result("exact-lossy", "mp3", bitrate_kbps=320),
                result("inexact-lossless", "flac", duration_ms=ITEM_DURATION_MS + 30_000),
                result("exact-lossless", "flac"),
            ],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["exact-lossless", "exact-lossy", "inexact-lossless"]

    def test_unknown_duration_sorts_last(self) -> None:
        shaped = shape_results(
            [
                result("mystery", "flac", duration_ms=None),
                result("off-by-a-minute", "mp3", duration_ms=ITEM_DURATION_MS + 60_000),
                result("exact", "mp3"),
            ],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["exact", "off-by-a-minute", "mystery"]

    def test_within_tier_smaller_delta_wins(self) -> None:
        shaped = shape_results(
            [
                result("off-20s", duration_ms=ITEM_DURATION_MS + 20_000),
                result("off-5s", duration_ms=ITEM_DURATION_MS + 5_000),
            ],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["off-5s", "off-20s"]

    def test_bitrate_breaks_exact_lossy_ties(self) -> None:
        shaped = shape_results(
            [result("128", bitrate_kbps=128), result("320", bitrate_kbps=320)],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["320", "128"]

    def test_free_slot_breaks_remaining_ties(self) -> None:
        shaped = shape_results(
            [
                result("queued", bitrate_kbps=320, queue_length=45, has_free_slot=False),
                result("free", bitrate_kbps=320, queue_length=0, has_free_slot=True),
            ],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["free", "queued"]

"""Picker result shaping (soulseek-supplier issue 04): pure semantics over
canned search results — filtering, duration deltas, best-pick-first ordering.
"""

from backend.acquisition.picker import (
    auto_candidates,
    dicts_to_shaped,
    result_from_dict,
    shape_results,
)
from backend.acquisition.supplier import SupplierSearchResult

ITEM_DURATION_MS = 200_000


def result(
    token: str,
    format: str = "mp3",
    duration_ms: int | None = ITEM_DURATION_MS,
    bitrate_kbps: int | None = None,
    queue_length: int | None = 0,
    has_free_slot: bool | None = None,
    username: str | None = None,
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
        username=username,
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
    def test_exact_hq_mp3_first_then_lossless(self) -> None:
        """gh#214 feedback: a high-quality mp3 is the pick this library
        wants — it outranks lossless; low-bitrate mp3s rank below lossless."""
        shaped = shape_results(
            [
                result("exact-low-mp3", "mp3", bitrate_kbps=128),
                result("exact-hq-mp3", "mp3", bitrate_kbps=320),
                result("inexact-lossless", "flac", duration_ms=ITEM_DURATION_MS + 30_000),
                result("exact-lossless", "flac"),
            ],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == [
            "exact-hq-mp3", "exact-lossless", "exact-low-mp3", "inexact-lossless",
        ]

    def test_quality_beats_delta_within_exact_group(self) -> None:
        """All exact-duration candidates are the right recording — a 320
        mp3 two seconds off beats a spot-on flac."""
        shaped = shape_results(
            [
                result("spot-on-flac", "flac", duration_ms=ITEM_DURATION_MS),
                result(
                    "close-hq-mp3", "mp3", bitrate_kbps=320,
                    duration_ms=ITEM_DURATION_MS + 2_000,
                ),
            ],
            ITEM_DURATION_MS,
        )
        assert order(shaped) == ["close-hq-mp3", "spot-on-flac"]

    def test_no_item_duration_sorts_by_quality(self) -> None:
        """Standalone searches (gh#217) have no duration to compare against:
        no deltas, quality-only ordering."""
        shaped = shape_results(
            [
                result("flac", "flac", duration_ms=180_000),
                result("hq-mp3", "mp3", bitrate_kbps=320, duration_ms=240_000),
                result("low-mp3", "mp3", bitrate_kbps=128, duration_ms=200_000),
            ],
            None,
        )
        assert all(s.duration_delta_ms is None for s in shaped)
        assert order(shaped) == ["hq-mp3", "flac", "low-mp3"]

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


class TestAutoCandidates:
    """The hands-off pick list (gh#214): mp3-only, duration within ±5s,
    healthy bitrate, one candidate per peer, capped at five sources."""

    def test_only_close_duration_high_bitrate_mp3s(self) -> None:
        shaped = shape_results(
            [
                result("good", "mp3", bitrate_kbps=320, username="a"),
                result("lossless", "flac", username="b"),
                result("low-bitrate", "mp3", bitrate_kbps=128, username="c"),
                result("no-bitrate", "mp3", username="d"),
                result(
                    "wrong-length", "mp3", bitrate_kbps=320,
                    duration_ms=ITEM_DURATION_MS + 30_000, username="e",
                ),
                result("mystery-length", "mp3", bitrate_kbps=320, duration_ms=None, username="f"),
            ],
            ITEM_DURATION_MS,
        )
        assert order(auto_candidates(shaped)) == ["good"]

    def test_a_few_seconds_off_is_fine(self) -> None:
        """gh#214 feedback: ±5s is acceptable for a blind pick; beyond is not."""
        shaped = shape_results(
            [
                result(
                    "4s-off", "mp3", bitrate_kbps=320,
                    duration_ms=ITEM_DURATION_MS + 4_000, username="a",
                ),
                result(
                    "6s-off", "mp3", bitrate_kbps=320,
                    duration_ms=ITEM_DURATION_MS - 6_000, username="b",
                ),
            ],
            ITEM_DURATION_MS,
        )
        assert order(auto_candidates(shaped)) == ["4s-off"]

    def test_one_candidate_per_peer_best_first(self) -> None:
        shaped = shape_results(
            [
                result("a-320", "mp3", bitrate_kbps=320, username="a"),
                result("a-256", "mp3", bitrate_kbps=256, username="a"),
                result("b-256", "mp3", bitrate_kbps=256, username="b"),
            ],
            ITEM_DURATION_MS,
        )
        assert order(auto_candidates(shaped)) == ["a-320", "b-256"]

    def test_capped_at_five_sources(self) -> None:
        shaped = shape_results(
            [
                result(f"peer{i}", "mp3", bitrate_kbps=320, username=f"u{i}")
                for i in range(8)
            ],
            ITEM_DURATION_MS,
        )
        assert len(auto_candidates(shaped)) == 5

    def test_unknown_peers_are_distinct(self) -> None:
        shaped = shape_results(
            [
                result("one", "mp3", bitrate_kbps=320),
                result("two", "mp3", bitrate_kbps=320),
            ],
            ITEM_DURATION_MS,
        )
        assert len(auto_candidates(shaped)) == 2


class TestCandidateSerialization:
    def test_result_from_dict_ignores_extras_and_tolerates_missing(self) -> None:
        r = result("tok", "mp3", bitrate_kbps=320, username="peer")
        d = {**vars(r), "duration_delta_ms": 0}
        assert result_from_dict(d) == r
        del d["username"]
        assert result_from_dict(d).username is None

    def test_dicts_to_shaped_reads_stored_deltas(self) -> None:
        shaped = shape_results([result("tok", "mp3", bitrate_kbps=320)], ITEM_DURATION_MS)
        dicts = [{**vars(s.result), "duration_delta_ms": s.duration_delta_ms} for s in shaped]
        rehydrated = dicts_to_shaped(dicts)
        assert rehydrated == shaped

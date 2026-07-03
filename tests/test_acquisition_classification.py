"""Classification: heuristics assign track/mix/clip/other to Source Items.

Pure-logic unit tests for the heuristic + module-interface tests for
assignment at Refresh, backfill, and override persistence (ADR-0002).
"""

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.classification import ClassificationConfig, classify
from backend.acquisition.manager import list_source_items, refresh, set_classification

from .conftest import FakeSource
from .test_acquisition_refresh import item_data

CFG = ClassificationConfig(
    clip_max_duration_secs=90,
    mix_min_duration_secs=1200,
    mix_keywords=["mixtape", "podcast", "b2b", "dj set", "guest mix"],
    clip_keywords=["preview", "snippet", "clip", "teaser"],
)


def mins(n: float) -> int:
    return int(n * 60_000)


class TestClassifyHeuristic:
    def test_ordinary_track(self) -> None:
        assert classify("Hoax - Wake Up", mins(4.5), CFG) == "track"

    def test_long_duration_is_mix(self) -> None:
        assert classify("HÖR - Marlon Hoffstadt | April 2025", mins(61), CFG) == "mix"

    def test_short_duration_is_clip(self) -> None:
        assert classify("Fractal - Gravity (OUT NOW)", 62_000, CFG) == "clip"

    def test_mix_keyword_at_normal_duration(self) -> None:
        assert classify("Sunset Mixtape Vol. 4", mins(6), CFG) == "mix"

    def test_clip_keyword_at_normal_duration(self) -> None:
        assert classify("DJ Boring - Winona (snippet)", mins(4), CFG) == "clip"

    def test_remix_does_not_match_mix_keywords(self) -> None:
        """Keyword matching is word-boundary and phrase-based: remixes are tracks."""
        assert classify("Overmono - So U Kno (Bicep Remix)", mins(5), CFG) == "track"

    def test_ordinary_track_naming_is_not_a_mix(self) -> None:
        """'(Original Mix)', 'VIP Mix', 'Set Me Free' are ordinary tracks."""
        assert classify("DJ Hazard - Mr Happy (Original Mix)", mins(5), CFG) == "track"
        assert classify("Positions (VIP Mix)", mins(3), CFG) == "track"
        assert classify("Prolix - Set Me Free (Pythius Remix)", mins(4), CFG) == "track"

    def test_keyword_matching_is_case_insensitive(self) -> None:
        assert classify("SATURDAY NIGHT MIXTAPE", mins(10), CFG) == "mix"

    def test_duration_extreme_beats_keyword(self) -> None:
        """A 45-second item titled 'mixtape' is still a clip."""
        assert classify("micro mixtape", 45_000, CFG) == "clip"


class TestClassificationAtRefresh:
    def test_refresh_assigns_classification(self, db_session: Session) -> None:
        source = FakeSource(
            [
                item_data("1", title="Hoax - Wake Up", duration_ms=mins(4.5)),
                item_data("2", title="HÖR | April 2025", duration_ms=mins(61)),
            ]
        )
        refresh(db_session, source, classification_config=CFG)

        by_ext = {i.external_id: i for i in list_source_items(db_session)}
        assert by_ext["1"].classification == "track"
        assert by_ext["2"].classification == "mix"

    def test_refresh_backfills_unclassified_rows(self, db_session: Session) -> None:
        """Rows from before the classification column existed get classified."""
        source = FakeSource([item_data("1", duration_ms=mins(61))])
        refresh(db_session, source, classification_config=CFG)
        item = list_source_items(db_session)[0]
        item.classification = None
        db_session.commit()

        refresh(db_session, FakeSource([]), classification_config=CFG)

        assert list_source_items(db_session)[0].classification == "mix"

    def test_override_survives_refresh(self, db_session: Session) -> None:
        source = FakeSource([item_data("1", duration_ms=mins(61))])
        refresh(db_session, source, classification_config=CFG)
        item = list_source_items(db_session)[0]

        set_classification(db_session, item.id, "track")
        refresh(db_session, source, classification_config=CFG)

        assert list_source_items(db_session)[0].classification == "track"

    def test_set_classification_rejects_unknown_value(self, db_session: Session) -> None:
        refresh(db_session, FakeSource([item_data("1")]), classification_config=CFG)
        item = list_source_items(db_session)[0]

        with pytest.raises(ValueError):
            set_classification(db_session, item.id, "banger")

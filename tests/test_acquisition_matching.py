"""Source Correspondence: matching Source Items to Tracks.

Pure-logic tests for normalization/scoring, plus module-interface tests for
the three-tier matching pass, proposals, manual linking, and fulfilled state
(ADR-0002). See CONTEXT.md: Source Correspondence.
"""

from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.manager import (
    accept_proposal,
    backfill_track_durations,
    get_correspondence,
    link_item_to_track,
    link_track_by_url,
    list_source_items,
    refresh,
    reject_proposal,
    run_matching,
)
from backend.acquisition.matching import MatchingConfig, normalize, score_pair
from backend.acquisition.models import SourceItem
from backend.models import Track

from .conftest import FakeSource
from .test_acquisition_refresh import item_data

CFG = MatchingConfig()


class TestNormalize:
    def test_lowercases_and_collapses_whitespace(self) -> None:
        assert normalize("Hoax   -  Wake UP") == "hoax wake up"

    def test_strips_junk_tokens(self) -> None:
        assert normalize("Kessler - Lucid [FREE DL]") == "kessler lucid"
        assert normalize("Fractal - Gravity (FREE DOWNLOAD) OUT NOW!") == "fractal gravity"

    def test_strips_punctuation(self) -> None:
        assert normalize("X CLUB. - HARD 2 FORGET") == "x club hard 2 forget"


class TestScorePair:
    def test_exact_artist_title_scores_one(self) -> None:
        score = score_pair(
            item_title="Hoax - Wake Up",
            item_uploader="hoaxdnb",
            track_title="Wake Up",
            track_artist="Hoax",
            track_filename="/tracks/Hoax - Wake Up.mp3",
        )
        assert score == pytest.approx(1.0)

    def test_uploader_as_artist_matches(self) -> None:
        """SoundCloud title is bare; uploader supplies the artist."""
        score = score_pair(
            item_title="GLUE",
            item_uploader="Bicep",
            track_title="Glue",
            track_artist="Bicep",
            track_filename="/tracks/Bicep - Glue.mp3",
        )
        assert score == pytest.approx(1.0)

    def test_junk_does_not_prevent_match(self) -> None:
        score = score_pair(
            item_title="Kessler - Lucid ⚡ FREE DOWNLOAD",
            item_uploader="Kessler",
            track_title="Lucid",
            track_artist="Kessler",
            track_filename="/tracks/Kessler - Lucid.mp3",
        )
        assert score == pytest.approx(1.0)

    def test_unrelated_titles_score_low(self) -> None:
        score = score_pair(
            item_title="Hoax - Wake Up",
            item_uploader="hoaxdnb",
            track_title="Watercolour",
            track_artist="Pendulum",
            track_filename="/tracks/Pendulum - Watercolour.mp3",
        )
        assert score < 0.5


class TestRunMatching:
    def test_exact_match_with_duration_auto_confirms(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        # track arrives after the refresh, so the explicit matching pass finds it
        refresh(db_session, FakeSource([item_data("1", title="Hoax - Wake Up", duration_ms=274_416)]))
        track = make_track(title="Wake Up", artist="Hoax", duration_secs=274.4)

        stats = run_matching(db_session, CFG)

        assert stats.auto_confirmed == 1
        item = list_source_items(db_session)[0]
        assert item.state == "fulfilled"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None
        assert corr.track_id == track.id
        assert corr.status == "confirmed"

    def test_fuzzy_match_creates_proposal_not_fulfilled(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        refresh(
            db_session,
            FakeSource([item_data("1", title="Sansibar - Aurora w/ DJ G2G", duration_ms=301_000)]),
        )
        track = make_track(title="Aurora", artist="Sansibar & DJ G2G", duration_secs=302.0)

        stats = run_matching(db_session, CFG)

        assert stats.auto_confirmed == 0
        assert stats.proposed == 1
        item = list_source_items(db_session)[0]
        assert item.state == "new"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None
        assert corr.track_id == track.id
        assert corr.status == "proposed"
        assert corr.score is not None

    def test_no_plausible_track_leaves_item_unmatched(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        refresh(db_session, FakeSource([item_data("1", title="Hoax - Wake Up", duration_ms=274_416)]))
        make_track(title="Watercolour", artist="Pendulum", duration_secs=231.0)

        stats = run_matching(db_session, CFG)

        assert stats.auto_confirmed == 0 and stats.proposed == 0
        assert get_correspondence(db_session, list_source_items(db_session)[0].id) is None

    def test_duration_mismatch_blocks_even_exact_title(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        """The clip case: same title, 45s audio vs a 4:34 track."""
        refresh(db_session, FakeSource([item_data("1", title="Hoax - Wake Up", duration_ms=45_000)]))
        make_track(title="Wake Up", artist="Hoax", duration_secs=274.4)

        stats = run_matching(db_session, CFG)

        assert stats.auto_confirmed == 0 and stats.proposed == 0

    def test_matching_runs_as_part_of_refresh(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        make_track(title="Wake Up", artist="Hoax", duration_secs=274.4)

        refresh(db_session, FakeSource([item_data("1", title="Hoax - Wake Up", duration_ms=274_416)]))

        assert list_source_items(db_session)[0].state == "fulfilled"

    def test_ignored_and_fulfilled_items_are_skipped(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        make_track(title="Wake Up", artist="Hoax", duration_secs=274.4)
        refresh(db_session, FakeSource([item_data("1", title="Hoax - Wake Up", duration_ms=274_416)]))
        item = list_source_items(db_session)[0]
        assert item.state == "fulfilled"  # matched during refresh

        stats = run_matching(db_session, CFG)  # second pass: nothing to do

        assert stats.auto_confirmed == 0 and stats.proposed == 0


class TestProposalActions:
    def _proposal_setup(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> "tuple[Track, SourceItem]":
        track = make_track(title="Aurora", artist="Sansibar & DJ G2G", duration_secs=302.0)
        refresh(
            db_session,
            FakeSource([item_data("1", title="Sansibar - Aurora w/ DJ G2G", duration_ms=301_000)]),
        )
        return track, list_source_items(db_session)[0]

    def test_accept_proposal_fulfills(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        track, item = self._proposal_setup(db_session, make_track)

        accept_proposal(db_session, item.id)

        assert item.state == "fulfilled"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed" and corr.track_id == track.id

    def test_reject_proposal_removes_it(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        _, item = self._proposal_setup(db_session, make_track)

        reject_proposal(db_session, item.id)

        assert item.state == "new"
        assert get_correspondence(db_session, item.id) is None

    def test_rejected_proposal_is_not_reproposed(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        _, item = self._proposal_setup(db_session, make_track)
        reject_proposal(db_session, item.id)

        stats = run_matching(db_session, CFG)

        assert stats.proposed == 0
        assert get_correspondence(db_session, item.id) is None


class TestManualLink:
    def test_link_item_to_track(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        track = make_track(title="Completely Different", artist="Someone")
        refresh(db_session, FakeSource([item_data("1")]))
        item = list_source_items(db_session)[0]

        link_item_to_track(db_session, item.id, int(track.id))

        assert item.state == "fulfilled"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed" and corr.track_id == track.id

    def test_link_track_by_url(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        track = make_track(title="Wake Up", artist="Hoax")
        refresh(
            db_session,
            FakeSource(
                [item_data("1", permalink_url="https://soundcloud.com/hoaxdnb/wake-up")]
            ),
        )

        link_track_by_url(db_session, "https://soundcloud.com/hoaxdnb/wake-up", int(track.id))

        item = list_source_items(db_session)[0]
        assert item.state == "fulfilled"

    def test_link_track_by_unknown_url_raises(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        track = make_track()
        with pytest.raises(LookupError):
            link_track_by_url(db_session, "https://soundcloud.com/nobody/nothing", int(track.id))


class TestDurationBackfill:
    def test_backfills_from_audio_file(
        self,
        db_session: Session,
        make_track: Callable[..., Track],
        audio_file: Callable[..., Path],
    ) -> None:
        path = audio_file("mp3")
        track = make_track(filename=str(path), duration_secs=None)

        updated = backfill_track_durations(db_session)

        assert updated == 1
        db_session.refresh(track)
        assert track.duration_secs is not None and track.duration_secs > 0

    def test_missing_file_is_skipped(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        make_track(filename="/nowhere/gone.mp3", duration_secs=None)

        assert backfill_track_durations(db_session) == 0

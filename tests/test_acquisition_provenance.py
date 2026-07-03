"""Asserted Audio Provenance: the acquired-elsewhere story (issue 09).

Unit tests for origin-label derivation + module-interface tests for
link-and-assert. See CONTEXT.md (Audio Provenance, External Source) and
ADR-0006.
"""

from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.manager import (
    assert_provenance,
    link_item_to_track,
    list_source_items,
    refresh,
)
from backend.acquisition.models import AudioProvenance
from backend.acquisition.provenance import derive_label
from backend.models import Track

from .conftest import FakeSource
from .test_acquisition_refresh import item_data


class TestDeriveLabel:
    def test_known_hosts(self) -> None:
        assert derive_label("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "youtube"
        assert derive_label("https://youtu.be/dQw4w9WgXcQ") == "youtube"
        assert derive_label("https://www.beatport.com/track/omen/12345") == "beatport"
        assert derive_label("https://soundcloud.com/hoaxdnb/wake-up") == "soundcloud"

    def test_bandcamp_artist_subdomains(self) -> None:
        assert derive_label("https://sansibar.bandcamp.com/track/aurora") == "bandcamp"

    def test_unknown_host_is_bare_host(self) -> None:
        assert derive_label("https://freemusicarchive.org/some/track") == "freemusicarchive.org"

    def test_www_is_stripped(self) -> None:
        assert derive_label("http://www.example.com/x") == "example.com"


class TestLinkAndAssert:
    def _item_and_track(
        self, db: Session, make_track: Callable[..., Track]
    ) -> "tuple[int, int]":
        refresh(db, FakeSource([item_data("111")]))
        item = list_source_items(db)[0]
        track = make_track(title="Wake Up", artist="Hoax")
        return item.id, int(track.id)

    def test_link_with_url_asserts_provenance(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        item_id, track_id = self._item_and_track(db_session, make_track)

        link_item_to_track(
            db_session, item_id, track_id, audio_from="https://www.beatport.com/track/wake-up/999"
        )

        prov = db_session.query(AudioProvenance).filter_by(track_id=track_id).one()
        assert prov.source == "beatport"
        assert prov.url == "https://www.beatport.com/track/wake-up/999"
        assert prov.asserted is True
        assert prov.external_id is None
        assert prov.acquired_at is not None

    def test_link_with_bare_label(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        item_id, track_id = self._item_and_track(db_session, make_track)

        link_item_to_track(db_session, item_id, track_id, audio_from="cd-rip")

        prov = db_session.query(AudioProvenance).filter_by(track_id=track_id).one()
        assert prov.source == "cd-rip"
        assert prov.url is None
        assert prov.asserted is True

    def test_link_without_audio_from_writes_no_provenance(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        item_id, track_id = self._item_and_track(db_session, make_track)

        link_item_to_track(db_session, item_id, track_id)

        assert db_session.query(AudioProvenance).filter_by(track_id=track_id).count() == 0

    def test_assert_overwrites_existing_provenance(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        """Provenance describes the current audio file — one row per Track."""
        item_id, track_id = self._item_and_track(db_session, make_track)
        link_item_to_track(db_session, item_id, track_id, audio_from="cd-rip")

        link_item_to_track(
            db_session, item_id, track_id, audio_from="https://youtu.be/dQw4w9WgXcQ"
        )

        provs = db_session.query(AudioProvenance).filter_by(track_id=track_id).all()
        assert len(provs) == 1
        assert provs[0].source == "youtube"


class TestEditAssertedProvenance:
    """Fulfilled items with no recorded provenance keep an editable audio-from."""

    def _fulfilled(
        self, db: Session, make_track: Callable[..., Track], audio_from: str | None = None
    ) -> "tuple[int, int]":
        refresh(db, FakeSource([item_data("111")]))
        item = list_source_items(db)[0]
        track = make_track(title="Wake Up", artist="Hoax")
        link_item_to_track(db, item.id, int(track.id), audio_from=audio_from)
        return item.id, int(track.id)

    def test_set_provenance_after_plain_link(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        item_id, track_id = self._fulfilled(db_session, make_track)

        assert_provenance(db_session, item_id, "https://www.beatport.com/track/x/1")

        prov = db_session.query(AudioProvenance).filter_by(track_id=track_id).one()
        assert prov.source == "beatport" and prov.asserted is True

    def test_update_asserted_provenance(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        item_id, track_id = self._fulfilled(db_session, make_track, audio_from="cd-rip")

        assert_provenance(db_session, item_id, "https://youtu.be/xyz")

        prov = db_session.query(AudioProvenance).filter_by(track_id=track_id).one()
        assert prov.source == "youtube" and prov.url == "https://youtu.be/xyz"

    def test_recorded_provenance_is_immutable(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        item_id, track_id = self._fulfilled(db_session, make_track)
        db_session.add(
            AudioProvenance(track_id=track_id, source="soundcloud", external_id="111", asserted=False)
        )
        db_session.commit()

        with pytest.raises(ValueError):
            assert_provenance(db_session, item_id, "cd-rip")

    def test_link_cannot_clobber_recorded_provenance(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        refresh(db_session, FakeSource([item_data("111")]))
        item = list_source_items(db_session)[0]
        track = make_track(title="Wake Up", artist="Hoax")
        db_session.add(
            AudioProvenance(
                track_id=int(track.id), source="soundcloud", external_id="111", asserted=False
            )
        )
        db_session.commit()

        with pytest.raises(ValueError):
            link_item_to_track(db_session, item.id, int(track.id), audio_from="cd-rip")

    def test_requires_fulfilled_item(self, db_session: Session) -> None:
        refresh(db_session, FakeSource([item_data("111")]))
        item = list_source_items(db_session)[0]

        with pytest.raises(LookupError):
            assert_provenance(db_session, item.id, "cd-rip")

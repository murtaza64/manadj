"""Acquisition: Refresh persists SoundCloud likes as Source Items.

Module-interface tests (ADR-0002): real DB session, fake Source at the seam.
"""

from sqlalchemy.orm import Session

from backend.acquisition.manager import list_source_items, refresh
from backend.acquisition.source import SourceItemData

from .conftest import FakeSource


def item_data(external_id: str = "111", **overrides: object) -> SourceItemData:
    defaults: dict[str, object] = {
        "external_id": external_id,
        "title": "Hoax - Wake Up",
        "uploader": "hoaxdnb",
        "duration_ms": 274431,
        "permalink_url": "https://soundcloud.com/hoaxdnb/wake-up",
        "liked_at": "2026-07-02T22:20:00Z",
    }
    defaults.update(overrides)
    return SourceItemData(**defaults)  # type: ignore[arg-type]


def test_refresh_persists_source_items(db_session: Session) -> None:
    source = FakeSource([item_data("111"), item_data("222", title="Bicep - GLUE")])

    stats = refresh(db_session, source)

    assert stats.added == 2
    assert stats.total_remote == 2
    assert stats.total_local == 2

    items = list_source_items(db_session)
    assert len(items) == 2
    by_ext = {i.external_id: i for i in items}
    item = by_ext["111"]
    assert item.source == "soundcloud"
    assert item.title == "Hoax - Wake Up"
    assert item.uploader == "hoaxdnb"
    assert item.duration_ms == 274431
    assert item.permalink_url == "https://soundcloud.com/hoaxdnb/wake-up"
    assert item.state == "new"
    assert item.liked_at == "2026-07-02T22:20:00Z"


def test_refresh_is_idempotent(db_session: Session) -> None:
    source = FakeSource([item_data("111")])

    refresh(db_session, source)
    stats = refresh(db_session, source)

    assert stats.added == 0
    assert stats.total_local == 1
    assert len(list_source_items(db_session)) == 1


def test_refresh_only_adds_never_deletes(db_session: Session) -> None:
    """An item unliked upstream stays local (Refresh only ever adds)."""
    refresh(db_session, FakeSource([item_data("111"), item_data("222")]))

    stats = refresh(db_session, FakeSource([item_data("222")]))

    assert stats.added == 0
    assert stats.total_remote == 1
    assert stats.total_local == 2


def test_refresh_does_not_clobber_existing_item_state(db_session: Session) -> None:
    refresh(db_session, FakeSource([item_data("111")]))
    item = list_source_items(db_session)[0]
    item.state = "ignored"
    db_session.commit()

    refresh(db_session, FakeSource([item_data("111", title="Renamed Upstream")]))

    item = list_source_items(db_session)[0]
    assert item.state == "ignored"
    # metadata is not rewritten either — the local record was already made
    assert item.title == "Hoax - Wake Up"


def test_refresh_adds_new_items_alongside_existing(db_session: Session) -> None:
    refresh(db_session, FakeSource([item_data("111")]))

    stats = refresh(db_session, FakeSource([item_data("111"), item_data("333", title="New Like")]))

    assert stats.added == 1
    assert {i.external_id for i in list_source_items(db_session)} == {"111", "333"}

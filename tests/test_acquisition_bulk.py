"""The ignore/restore lifecycle (issue 06; queueing removed in gh#488/#489)."""

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.models import SourceItem

from backend.acquisition.manager import (
    ignore_item,
    list_source_items,
    refresh,
    restore_item,
)

from .conftest import FakeSource
from .test_acquisition_refresh import item_data


def seed(db: Session, n: int = 3) -> "list[SourceItem]":
    refresh(db, FakeSource([item_data(str(i), title=f"Artist {i} - Track {i}") for i in range(n)]))
    return list_source_items(db)


class TestIgnoreRestore:
    def test_ignore_new_item(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        ignore_item(db_session, item.id)
        assert item.state == "ignored"

    def test_ignore_legacy_queued_item(self, db_session: Session) -> None:
        """A pre-removal `queued` row counts as new: no download path remains."""
        item = seed(db_session, 1)[0]
        item.state = "queued"
        db_session.commit()

        ignore_item(db_session, item.id)

        assert item.state == "ignored"

    def test_cannot_ignore_fulfilled(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        item.state = "fulfilled"
        db_session.commit()
        with pytest.raises(ValueError):
            ignore_item(db_session, item.id)

    def test_restore_ignored_to_new(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        ignore_item(db_session, item.id)
        restore_item(db_session, item.id)
        assert item.state == "new"

    def test_restore_rejects_non_ignored(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        with pytest.raises(ValueError):
            restore_item(db_session, item.id)
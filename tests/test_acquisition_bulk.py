"""Bulk queueing and the ignore/restore lifecycle (issue 06)."""

from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.models import SourceItem
from backend.models import Track

from backend.acquisition.manager import (
    ignore_item,
    list_source_items,
    queue_bulk,
    queue_item,
    refresh,
    restore_item,
)
from backend.tasks.manager import list_tasks

from .conftest import FakeSource
from .test_acquisition_refresh import item_data


def seed(db: Session, n: int = 3) -> "list[SourceItem]":
    refresh(db, FakeSource([item_data(str(i), title=f"Artist {i} - Track {i}") for i in range(n)]))
    return list_source_items(db)


class TestQueueBulk:
    def test_queues_only_queueable_items(self, db_session: Session) -> None:
        items = seed(db_session, 4)
        items[1].state = "fulfilled"
        items[2].state = "ignored"
        db_session.commit()

        stats = queue_bulk(db_session, [i.id for i in items])

        assert stats.queued == 2
        assert stats.skipped == 2
        states = {i.external_id: i.state for i in list_source_items(db_session)}
        assert states[items[1].external_id] == "fulfilled"
        assert states[items[2].external_id] == "ignored"
        assert len(list_tasks(db_session, state="pending")) == 2

    def test_does_not_double_queue(self, db_session: Session) -> None:
        items = seed(db_session, 2)
        queue_item(db_session, items[0].id)

        stats = queue_bulk(db_session, [i.id for i in items])

        assert stats.queued == 2  # idempotent: existing pending task reused
        assert len(list_tasks(db_session, state="pending")) == 2

    def test_skips_failed_queued_items(self, db_session: Session) -> None:
        """Bulk catch-up must not hammer permanent failures; retry is explicit."""
        items = seed(db_session, 2)
        task = queue_item(db_session, items[0].id)
        task.state = "failed"
        task.error = "DRM protected"
        db_session.commit()

        stats = queue_bulk(db_session, [i.id for i in items])

        assert stats.queued == 1
        assert stats.skipped == 1
        assert len(list_tasks(db_session, ref=f"source_item:{items[0].id}")) == 1


class TestIgnoreRestore:
    def test_ignore_new_item(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        ignore_item(db_session, item.id)
        assert item.state == "ignored"

    def test_ignore_failed_queued_item(self, db_session: Session) -> None:
        """The DRM case: queued item whose download failed permanently."""
        item = seed(db_session, 1)[0]
        task = queue_item(db_session, item.id)
        task.state = "failed"
        db_session.commit()

        ignore_item(db_session, item.id)

        assert item.state == "ignored"

    def test_cannot_ignore_fulfilled(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        item.state = "fulfilled"
        db_session.commit()
        with pytest.raises(ValueError):
            ignore_item(db_session, item.id)

    def test_cannot_ignore_queued_with_live_task(self, db_session: Session) -> None:
        item = seed(db_session, 1)[0]
        queue_item(db_session, item.id)  # pending task
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


def test_queue_bulk_skips_items_with_pending_proposals(
    db_session: Session, make_track: Callable[..., Track]
) -> None:
    """A proposal means the track is probably already owned — resolve, don't download."""
    refresh(
        db_session,
        FakeSource([item_data("1", title="Sansibar - Aurora w/ DJ G2G", duration_ms=301_000)]),
    )
    make_track(title="Aurora", artist="Sansibar & DJ G2G", duration_secs=302.0)
    from backend.acquisition.manager import run_matching
    from backend.acquisition.matching import MatchingConfig

    run_matching(db_session, MatchingConfig())
    item = list_source_items(db_session)[0]

    stats = queue_bulk(db_session, [item.id])

    assert stats.queued == 0 and stats.skipped == 1

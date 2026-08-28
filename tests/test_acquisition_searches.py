"""Remembered Soulseek searches + the auto-search-on-failure chain (gh#216).

Module-interface tests at the Supplier seam (ADR-0002): fake Search Supplier,
real DB. Covers the persistence helpers, the `soulseek-search` task, and the
download handler's on_failure hook.
"""

from pathlib import Path

from sqlalchemy.orm import Session

from backend.acquisition.download import download_handler
from backend.acquisition.manager import list_source_items, queue_item, refresh
from backend.acquisition.models import SourceItem
from backend.acquisition.searches import (
    SOULSEEK_SEARCH_TASK_TYPE,
    enqueue_soulseek_search,
    remember_search,
    remembered_results,
    remembered_search,
    soulseek_search_handler,
)
from backend.acquisition.supplier import SupplierSearchResult
from backend.tasks.manager import list_tasks, run_pending

from .conftest import FakeSource
from .test_acquisition_refresh import item_data

RESULT = SupplierSearchResult(
    download_token="tok1",
    filename="@@peer\\Music\\Hoax - Wake Up.mp3",
    format="mp3",
    bitrate_kbps=320,
    size_bytes=9_000_000,
    duration_ms=274_000,
    queue_length=0,
)


def setup_item(db: Session, **overrides: object) -> SourceItem:
    refresh(
        db,
        FakeSource(
            [item_data("111", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb", **overrides)]
        ),
    )
    return list_source_items(db)[0]


def make_search_supplier() -> FakeSource:
    return FakeSource([], search_results=[RESULT])


class TestRememberedSearch:
    def test_roundtrip_and_overwrite(self, db_session: Session) -> None:
        item = setup_item(db_session)
        assert remembered_search(db_session, item.id) is None

        remember_search(db_session, item.id, "hoax wake up", [{"a": 1}])
        row = remembered_search(db_session, item.id)
        assert row is not None
        assert row.query == "hoax wake up"
        assert remembered_results(row) == [{"a": 1}]
        assert row.searched_at is not None

        # a new search overwrites — one remembered search per item
        remember_search(db_session, item.id, "wake up vip", [{"b": 2}])
        row = remembered_search(db_session, item.id)
        assert row is not None
        assert row.query == "wake up vip"
        assert remembered_results(row) == [{"b": 2}]


class TestSearchTask:
    def test_handler_searches_and_remembers(self, db_session: Session) -> None:
        item = setup_item(db_session)
        task = enqueue_soulseek_search(db_session, item)
        assert task is not None and task.type == SOULSEEK_SEARCH_TASK_TYPE

        handlers = {SOULSEEK_SEARCH_TASK_TYPE: soulseek_search_handler(make_search_supplier())}
        assert run_pending(db_session, handlers) == 1

        task = list_tasks(db_session, type_=SOULSEEK_SEARCH_TASK_TYPE)[0]
        assert task.state == "done", task.error
        row = remembered_search(db_session, item.id)
        assert row is not None
        assert row.query  # Cleanup-derived default
        results = remembered_results(row)
        assert len(results) == 1
        assert results[0]["filename"] == RESULT.filename
        assert results[0]["duration_delta_ms"] == RESULT.duration_ms - item.duration_ms

    def test_enqueue_skips_when_remembered_exists(self, db_session: Session) -> None:
        item = setup_item(db_session)
        remember_search(db_session, item.id, "operator query", [])
        assert enqueue_soulseek_search(db_session, item) is None

    def test_enqueue_skips_when_task_in_flight(self, db_session: Session) -> None:
        item = setup_item(db_session)
        assert enqueue_soulseek_search(db_session, item) is not None
        assert enqueue_soulseek_search(db_session, item) is None

    def test_handler_never_clobbers_existing_search(self, db_session: Session) -> None:
        item = setup_item(db_session)
        task = enqueue_soulseek_search(db_session, item)
        assert task is not None
        # the operator searches while the task waits its turn
        remember_search(db_session, item.id, "operator query", [{"mine": True}])

        handlers = {SOULSEEK_SEARCH_TASK_TYPE: soulseek_search_handler(make_search_supplier())}
        run_pending(db_session, handlers)

        row = remembered_search(db_session, item.id)
        assert row is not None and row.query == "operator query"

    def test_handler_skips_fulfilled_items(self, db_session: Session) -> None:
        item = setup_item(db_session)
        task = enqueue_soulseek_search(db_session, item)
        assert task is not None
        item.state = "fulfilled"
        db_session.commit()

        handlers = {SOULSEEK_SEARCH_TASK_TYPE: soulseek_search_handler(make_search_supplier())}
        run_pending(db_session, handlers)

        assert remembered_search(db_session, item.id) is None

    def test_search_task_does_not_block_picks(self, db_session: Session, tmp_path: Path) -> None:
        """The pending search task must not trip the pick in-flight guard —
        its ref is distinct from the download task's."""
        from backend.acquisition.download import pick_supplier_result

        staging = tmp_path / "staging"
        staging.mkdir()
        supplier = FakeSource([], search_results=[RESULT], staging_dir=staging)
        item = setup_item(db_session)
        assert enqueue_soulseek_search(db_session, item) is not None

        pick_supplier_result(db_session, item.id, supplier, RESULT)  # does not raise


class TestFailureHook:
    def make_failing_handlers(self, tracks_dir: Path, error: Exception) -> tuple[FakeSource, dict]:
        source = FakeSource(
            [item_data("111", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb")],
            download_error=error,
        )
        handlers = {
            "download": download_handler(
                source, tracks_dir, on_failure=enqueue_soulseek_search
            )
        }
        return source, handlers

    def test_terminal_failure_enqueues_search(self, db_session: Session, tmp_path: Path) -> None:
        source, handlers = self.make_failing_handlers(
            tmp_path, RuntimeError("HTTP 403: geo-blocked")
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, handlers)

        download = [t for t in list_tasks(db_session, ref=f"source_item:{item.id}")][0]
        assert download.state == "failed"
        searches = list_tasks(db_session, type_=SOULSEEK_SEARCH_TASK_TYPE)
        assert len(searches) == 1
        assert searches[0].payload["source_item_id"] == item.id

    def test_rate_limit_does_not_enqueue_search(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        """A 429 defers and retries — not terminal, no auto-search."""
        from backend.acquisition.source import RateLimitedError

        source, handlers = self.make_failing_handlers(
            tmp_path, RateLimitedError("HTTP Error 429: Too Many Requests")
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, handlers)

        download = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert download.state == "pending"  # backing off, not failed
        assert list_tasks(db_session, type_=SOULSEEK_SEARCH_TASK_TYPE) == []

    def test_hook_error_does_not_mask_download_error(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        source = FakeSource(
            [item_data("111")], download_error=RuntimeError("HTTP 403: geo-blocked")
        )
        def broken_hook(db: Session, item: SourceItem) -> None:
            raise RuntimeError("hook exploded")
        handlers = {"download": download_handler(source, tmp_path, on_failure=broken_hook)}
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, handlers)

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert task.error is not None and "geo-blocked" in task.error

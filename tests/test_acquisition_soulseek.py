"""The Soulseek chain: search -> pick -> soulseek-download task -> Track.

Module-interface tests at the Supplier seam (ADR-0002): the fake Search
Supplier cans search results and transfer-state sequences; real DB, real temp
files. The download-chain tests in test_acquisition_download.py are the prior
art — the Soulseek chain gets the same coverage plus the polling/TTL shape.
"""

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.download import (
    SOULSEEK_TASK_TYPE,
    pick_supplier_result,
    soulseek_download_handler,
)
from backend.acquisition.manager import get_correspondence, list_source_items, refresh
from backend.acquisition.models import AudioProvenance, SourceItem
from backend.acquisition.supplier import SupplierSearchResult, TransferState
from backend.models import Track
from backend.tasks.manager import Handler, list_tasks, run_pending
from backend.tasks.models import Task

from .conftest import FakeSource
from .test_acquisition_refresh import item_data

RESULT = SupplierSearchResult(
    download_token="tok1",
    filename="@@peer\\Music\\Hoax - Wake Up (soulseek rip).mp3",
    format="mp3",
    bitrate_kbps=320,
    size_bytes=9_000_000,
    duration_ms=274_000,
    queue_length=0,
)


def make_supplier(
    tmp_path: Path,
    fixture: Path | None = None,
    transfer_states: list[TransferState] | None = None,
) -> FakeSource:
    staging = tmp_path / "slskd-staging"
    staging.mkdir(exist_ok=True)
    return FakeSource(
        [item_data("111", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb")],
        download_file=fixture,
        search_results=[RESULT],
        transfer_states=transfer_states,
        staging_dir=staging,
    )


def make_handlers(supplier: FakeSource, tracks_dir: Path) -> dict[str, Handler]:
    return {SOULSEEK_TASK_TYPE: soulseek_download_handler(supplier, tracks_dir)}


def setup_item(db: Session, supplier: FakeSource) -> SourceItem:
    refresh(db, supplier)
    return list_source_items(db)[0]


def release_deferral(db: Session, item: SourceItem) -> None:
    """Make the deferred poll due now (tests don't wait out the interval)."""
    task = list_tasks(db, ref=f"source_item:{item.id}")[0]
    task.not_before = None
    db.commit()


class TestPick:
    def test_pick_starts_transfer_and_queues_task(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        supplier = make_supplier(tmp_path)
        item = setup_item(db_session, supplier)

        task = pick_supplier_result(db_session, item.id, supplier, RESULT)

        assert item.state == "queued"
        assert task.type == SOULSEEK_TASK_TYPE
        assert task.ref == f"source_item:{item.id}"
        assert task.payload["source_item_id"] == item.id
        assert task.payload["transfer_id"] == "transfer:tok1"
        assert task.payload["filename"] == RESULT.filename
        # deadline ~24h out
        deadline = datetime.fromisoformat(task.payload["deadline"])
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        assert timedelta(hours=23) < (deadline - now) <= timedelta(hours=24)

    def test_pick_rejects_fulfilled_items(self, db_session: Session, tmp_path: Path) -> None:
        supplier = make_supplier(tmp_path)
        item = setup_item(db_session, supplier)
        item.state = "fulfilled"
        db_session.commit()

        with pytest.raises(ValueError):
            pick_supplier_result(db_session, item.id, supplier, RESULT)

    def test_pick_rejects_second_pick_while_in_flight(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        supplier = make_supplier(tmp_path)
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)

        with pytest.raises(ValueError):
            pick_supplier_result(db_session, item.id, supplier, RESULT)


class TestSoulseekChain:
    def test_queued_then_complete(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        """The full vertical: pick -> queued poll (deferred) -> completed ->
        moved under the Cleanup basename -> Track, Correspondence, label-only
        provenance, item fulfilled."""
        from backend.track_metadata import read_file_metadata

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        supplier = make_supplier(
            tmp_path,
            fixture=audio_file("mp3"),
            transfer_states=[TransferState.QUEUED, TransferState.COMPLETED],
        )
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)

        # first tick: transfer still queued -> task deferred, not failed
        assert run_pending(db_session, make_handlers(supplier, tracks_dir)) == 1
        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "pending"
        assert task.error is None
        assert task.not_before is not None  # polls again next tick, no blocking
        assert task.attempts == 0  # polling consumes no retry budget

        # second tick: transfer completed -> chain finishes
        release_deferral(db_session, item)
        assert run_pending(db_session, make_handlers(supplier, tracks_dir)) == 1
        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error

        # file moved under the Cleanup basename, extension from the picked file
        landed = list(tracks_dir.glob("Hoax - Wake Up.*"))
        assert len(landed) == 1
        assert landed[0].suffix == ".mp3"
        # staged copy is gone (moved, not copied)
        assert list((tmp_path / "slskd-staging").iterdir()) == []

        # cleaned tags embedded in the file
        file_meta = read_file_metadata(landed[0])
        assert file_meta.title == "Wake Up"
        assert file_meta.artist == "Hoax"

        # Track through Disk Import, curated fields set
        track = db_session.query(Track).filter(Track.filename == str(landed[0])).one()
        assert track.title == "Wake Up"
        assert track.artist == "Hoax"

        # Correspondence still points at the SoundCloud item; provenance is
        # label-only soulseek (no URL, no external ID) — two separate truths
        db_session.refresh(item)
        assert item.state == "fulfilled"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed" and corr.track_id == track.id
        prov = db_session.query(AudioProvenance).filter_by(track_id=track.id).one()
        assert prov.source == "soulseek"
        assert prov.external_id is None
        assert prov.url is None
        assert prov.asserted is False
        assert prov.acquired_at is not None

    def test_key_tagged_file_imports(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        """Regression: peer rips often carry a key tag; the Disk Import scan
        crashed on the first one (LibraryTrackCandidate.key was mistyped str
        while read_file_metadata returns an Engine key ID int)."""
        from backend.track_metadata import write_file_metadata

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        fixture = audio_file("mp3")
        write_file_metadata(fixture, key=23)  # Engine key ID, stored as TKEY
        supplier = make_supplier(
            tmp_path, fixture=fixture, transfer_states=[TransferState.COMPLETED]
        )
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)

        run_pending(db_session, make_handlers(supplier, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error
        db_session.refresh(item)
        assert item.state == "fulfilled"
        landed = list(tracks_dir.glob("Hoax - Wake Up.*"))
        track = db_session.query(Track).filter(Track.filename == str(landed[0])).one()
        assert track.key == 23

    def test_queued_then_ttl_expiry(self, db_session: Session, tmp_path: Path) -> None:
        """A transfer still queued past the hard TTL fails with a clear
        message; the item returns to searchable state and can be re-picked."""
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        supplier = make_supplier(tmp_path, transfer_states=[TransferState.QUEUED])
        item = setup_item(db_session, supplier)
        pick_supplier_result(
            db_session, item.id, supplier, RESULT, ttl=timedelta(seconds=-1)
        )

        run_pending(db_session, make_handlers(supplier, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert task.error is not None
        assert "not completed within" in task.error
        assert "search and pick again" in task.error

        # searchable again: not fulfilled, and a new pick is accepted
        db_session.refresh(item)
        assert item.state != "fulfilled"
        pick_supplier_result(db_session, item.id, supplier, RESULT)

    def test_transfer_failure_marks_task_failed(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        supplier = make_supplier(tmp_path, transfer_states=[TransferState.FAILED])
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)

        run_pending(db_session, make_handlers(supplier, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert task.error is not None and "search and pick again" in task.error
        db_session.refresh(item)
        assert item.state != "fulfilled"


class TestRetryAfterCrashedAttempt:
    def test_orphaned_file_is_adopted(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        """A crashed attempt left the moved file in the tracks directory with
        no Track. The retry pick adopts it without touching the transfer."""
        import shutil

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        shutil.copy(audio_file("mp3"), tracks_dir / "Hoax - Wake Up.mp3")
        # a transfer poll would defer forever; adoption must finish instead
        supplier = make_supplier(tmp_path, transfer_states=[TransferState.QUEUED])
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)

        run_pending(db_session, make_handlers(supplier, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error
        db_session.refresh(item)
        assert item.state == "fulfilled"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed"
        prov = (
            db_session.query(AudioProvenance).filter_by(track_id=corr.track_id).one()
        )
        assert prov.source == "soulseek"

    def test_file_referenced_by_track_still_raises(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
        make_track: Callable[..., Track],
    ) -> None:
        """A collision file already owned by a Track is a missed
        correspondence — an error, same as the SoundCloud chain."""
        import shutil

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        existing = tracks_dir / "Hoax - Wake Up.mp3"
        shutil.copy(audio_file("mp3"), existing)
        make_track(filename=str(existing), title="Wake Up")
        supplier = make_supplier(tmp_path, transfer_states=[TransferState.QUEUED])
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)

        run_pending(db_session, make_handlers(supplier, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert "correspondence" in (task.error or "")


class TestDeferredTaskSelection:
    def test_deferred_task_not_rerun_until_due(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        """A deferred poll sets not_before in the future, so the same
        run_pending loop doesn't spin on it."""
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        supplier = make_supplier(tmp_path, transfer_states=[TransferState.QUEUED])
        item = setup_item(db_session, supplier)
        pick_supplier_result(db_session, item.id, supplier, RESULT)
        handlers = make_handlers(supplier, tracks_dir)

        assert run_pending(db_session, handlers) == 1  # polled once, deferred
        assert run_pending(db_session, handlers) == 0  # not due yet

        task = db_session.query(Task).filter(Task.ref == f"source_item:{item.id}").one()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        assert task.not_before is not None and task.not_before > now

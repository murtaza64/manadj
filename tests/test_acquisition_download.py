"""The download chain: queue -> task -> file -> Track (issue 05).

Module-interface tests: real DB + real temp files; the fake Source "downloads"
by copying a committed audio fixture (ADR-0002).
"""

from collections.abc import Callable
from pathlib import Path

from sqlalchemy.orm import Session

from backend.acquisition.download import download_handler
from backend.acquisition.manager import get_correspondence, list_source_items, queue_item, refresh
from backend.acquisition.models import AudioProvenance, SourceItem
from backend.models import Track
from backend.tasks.manager import Handler, list_tasks, run_pending

from .conftest import FakeSource
from .test_acquisition_refresh import item_data


def make_handlers(source: FakeSource, tracks_dir: Path) -> dict[str, Handler]:
    return {"download": download_handler(source, tracks_dir)}


def setup_item(db: Session, **overrides: object) -> SourceItem:
    refresh(db, FakeSource([item_data("111", **overrides)]))
    return list_source_items(db)[0]


class TestQueueItem:
    def test_queue_creates_task_and_marks_item(self, db_session: Session) -> None:
        item = setup_item(db_session)

        task = queue_item(db_session, item.id)

        assert item.state == "queued"
        assert task.type == "download"
        assert task.ref == f"source_item:{item.id}"
        assert task.payload["source_item_id"] == item.id

    def test_queue_rejects_fulfilled_items(self, db_session: Session) -> None:
        item = setup_item(db_session)
        item.state = "fulfilled"
        db_session.commit()

        import pytest

        with pytest.raises(ValueError):
            queue_item(db_session, item.id)

    def test_queue_is_idempotent_while_pending(self, db_session: Session) -> None:
        item = setup_item(db_session)
        first = queue_item(db_session, item.id)
        second = queue_item(db_session, item.id)
        assert first.id == second.id


class TestDownloadChain:
    def test_full_chain(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        fixture = audio_file("mp3")
        source = FakeSource(
            [item_data("111", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb")],
            download_file=fixture,
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        processed = run_pending(db_session, make_handlers(source, tracks_dir))

        assert processed == 1
        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error

        # file landed with the Cleanup-derived name
        landed = list(tracks_dir.glob("Hoax - Wake Up.*"))
        assert len(landed) == 1

        # Track created through Disk Import, curated fields set
        track = db_session.query(Track).filter(Track.filename == str(landed[0])).one()
        assert track.title == "Wake Up"
        assert track.artist == "Hoax"
        assert track.duration_secs is not None and track.duration_secs > 0

        # Correspondence + Provenance recorded; item fulfilled
        db_session.refresh(item)
        assert item.state == "fulfilled"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed" and corr.track_id == track.id
        prov = db_session.query(AudioProvenance).filter_by(track_id=track.id).one()
        assert prov.source == "soundcloud"
        assert prov.external_id == "111"
        assert prov.asserted is False
        assert prov.url == "https://soundcloud.com/hoaxdnb/wake-up"
        assert prov.acquired_at is not None

    def test_filename_collision_fails_task(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        (tracks_dir / "Hoax - Wake Up.flac").write_bytes(b"existing")
        fixture = audio_file("mp3")
        source = FakeSource(
            [item_data("111", title="Hoax - Wake Up", uploader="hoaxdnb")],
            download_file=fixture,
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, make_handlers(source, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert task.error is not None and "Hoax - Wake Up" in task.error
        db_session.refresh(item)
        assert item.state == "queued"  # still queued; retry possible after cleanup
        assert db_session.query(Track).count() == 0

    def test_download_failure_marks_task_failed(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        source = FakeSource(
            [item_data("111")], download_error=RuntimeError("HTTP 403: geo-blocked")
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, make_handlers(source, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert task.error is not None and "geo-blocked" in task.error

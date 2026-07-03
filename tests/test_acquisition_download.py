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

    # (test_filename_collision_fails_task removed 2026-07-02: unreferenced
    # collisions are now adopted as crashed-attempt recovery; the referenced-
    # collision failure is covered by TestRetryAfterCrashedAttempt.)
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


class TestMetadataEmbedding:
    def test_cleaned_metadata_embedded_in_file(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        """The cleaned title/artist are Exported to Disk at acquisition: the
        downloaded file's tags carry what the Library asserts, not the raw
        SoundCloud strings."""
        from backend.track_metadata import read_file_metadata

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        source = FakeSource(
            [item_data("222", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb")],
            download_file=audio_file("m4a"),  # majority library format
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, make_handlers(source, tracks_dir))

        landed = list(tracks_dir.glob("Hoax - Wake Up.*"))
        assert len(landed) == 1
        meta = read_file_metadata(landed[0])
        assert meta.title == "Wake Up"
        assert meta.artist == "Hoax"

    def test_unreadable_file_does_not_fail_acquisition(
        self,
        db_session: Session,
        tmp_path: Path,
    ) -> None:
        """Embedding is best-effort: a file mutagen can't tag must not lose
        the acquisition."""
        garbage = tmp_path / "garbage.mp3"
        garbage.write_bytes(b"not really audio")
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        source = FakeSource(
            [item_data("333", title="Ghost - Track", uploader="x")],
            download_file=garbage,
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, make_handlers(source, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error
        db_session.refresh(item)
        assert item.state == "fulfilled"


class TestDownloadOverExistingCorrespondence:
    def test_download_repoints_proposed_correspondence(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
        make_track,
    ) -> None:
        """Regression: a proposed match + "download anyway" crashed with a
        UNIQUE violation on source_correspondences.source_item_id. The
        download must repoint the existing correspondence to the new track
        and confirm it."""
        from backend.acquisition.models import SourceCorrespondence

        suggested = make_track(title="leavemealone (old rip)")
        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        source = FakeSource(
            [item_data("444", title="Loboski - LEAVEMEALONE [FREE DL]", uploader="loboski")],
            download_file=audio_file("mp3"),
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        db_session.add(
            SourceCorrespondence(
                source_item_id=item.id, track_id=suggested.id, status="proposed", score=0.8
            )
        )
        db_session.commit()

        queue_item(db_session, item.id)
        run_pending(db_session, make_handlers(source, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error
        corr = get_correspondence(db_session, item.id)
        assert corr is not None
        assert corr.status == "confirmed"
        assert corr.score is None
        assert corr.track_id != suggested.id  # points at the downloaded track
        new_track = db_session.query(Track).filter(Track.id == corr.track_id).one()
        assert new_track.title == "LEAVEMEALONE"


class TestRetryAfterCrashedAttempt:
    def test_orphaned_file_is_adopted(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
    ) -> None:
        """A crashed attempt leaves the downloaded file on disk with no Track.
        Retry must adopt the file (not re-download, not raise FileExists)."""
        import shutil

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        # orphaned file from the "previous attempt"
        shutil.copy(audio_file("mp3"), tracks_dir / "Hoax - Wake Up.mp3")
        source = FakeSource(
            [item_data("555", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb")],
            download_error=AssertionError("download must not be called on adoption"),
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, make_handlers(source, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "done", task.error
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed"

    def test_file_referenced_by_track_still_raises(
        self,
        db_session: Session,
        tmp_path: Path,
        audio_file: Callable[..., Path],
        make_track,
    ) -> None:
        """A collision file already owned by a Track is a missed
        correspondence — still an error, not silent adoption."""
        import shutil

        tracks_dir = tmp_path / "tracks"
        tracks_dir.mkdir()
        existing = tracks_dir / "Hoax - Wake Up.mp3"
        shutil.copy(audio_file("mp3"), existing)
        make_track(filename=str(existing), title="Wake Up")
        source = FakeSource(
            [item_data("666", title="Hoax - Wake Up [FREE DL]", uploader="hoaxdnb")],
            download_file=audio_file("mp3"),
        )
        refresh(db_session, source)
        item = list_source_items(db_session)[0]
        queue_item(db_session, item.id)

        run_pending(db_session, make_handlers(source, tracks_dir))

        task = list_tasks(db_session, ref=f"source_item:{item.id}")[0]
        assert task.state == "failed"
        assert "correspondence" in (task.error or "")

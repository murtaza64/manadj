"""Disk Import derives asserted Audio Provenance from file hints — the
backfill's rules running permanently (yt-dlp filename IDs, tag URLs).

Module-interface tests per ADR-0002: real DB, real files, no mocks.
"""

import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from backend.acquisition.models import AudioProvenance
from backend.acquisition.manager import get_correspondence, list_source_items, refresh
from backend.library.import_manager import LibraryImportManager
from backend.models import Track

from .conftest import FakeSource
from .test_acquisition_refresh import item_data


def import_file(db: Session, tmp_path: Path, fixture: Path, name: str, **kwargs) -> Track:
    tracks_dir = tmp_path / "tracks"
    tracks_dir.mkdir(exist_ok=True)
    shutil.copy(fixture, tracks_dir / name)
    importer = LibraryImportManager(db, str(tracks_dir))
    candidates = importer.get_import_candidates().candidates
    result = importer.import_tracks(
        [c for c in candidates if Path(c.filepath).name == name], **kwargs
    )
    assert result.errors == 0, result.error_messages
    return db.query(Track).filter(Track.filename == str(tracks_dir / name)).one()


class TestDeriveAtImport:
    def test_youtube_filename_id(self, db_session, tmp_path, audio_file):
        track = import_file(
            db_session, tmp_path, audio_file("mp3"), "Fungal [jtoUov5u9Vs].mp3"
        )
        prov = db_session.query(AudioProvenance).filter_by(track_id=track.id).one()
        assert prov.source == "youtube"
        assert prov.url == "https://www.youtube.com/watch?v=jtoUov5u9Vs"
        assert prov.asserted is True
        assert prov.acquired_at is not None

    def test_soundcloud_id_confirms_pending_like(self, db_session, tmp_path, audio_file):
        refresh(db_session, FakeSource([item_data("256065630", title="Under the Waves")]))
        item = list_source_items(db_session)[0]

        track = import_file(
            db_session, tmp_path, audio_file("mp3"), "Under the Waves [256065630].mp3"
        )
        prov = db_session.query(AudioProvenance).filter_by(track_id=track.id).one()
        assert prov.source == "soundcloud"
        assert prov.external_id == "256065630"
        corr = get_correspondence(db_session, item.id)
        assert corr is not None and corr.status == "confirmed" and corr.track_id == track.id
        db_session.refresh(item)
        assert item.state == "fulfilled"

    def test_no_hints_no_provenance(self, db_session, tmp_path, audio_file):
        track = import_file(db_session, tmp_path, audio_file("flac"), "Plain Song.flac")
        assert db_session.query(AudioProvenance).filter_by(track_id=track.id).count() == 0

    def test_opt_out_for_download_path(self, db_session, tmp_path, audio_file):
        track = import_file(
            db_session, tmp_path, audio_file("mp3"), "Hinted [jtoUov5u9Vs].mp3",
            derive_provenance=False,
        )
        assert db_session.query(AudioProvenance).filter_by(track_id=track.id).count() == 0

"""Drop import (#297): Disk Import of dropped files/folders, in place."""

import shutil
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.library.drop_import import drop_import
from backend.main import app
from backend.models import Playlist, PlaylistTrack, Track
from backend.tasks.models import Task

FIXTURES = Path(__file__).parent / "fixtures"


def _copy(dest: Path, fmt: str = "mp3") -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / f"silence.{fmt}", dest)
    return dest


def test_files_and_folders_import_in_place(db, tmp_path):
    single = _copy(tmp_path / "loose" / "Artist - Single.mp3")
    folder = tmp_path / "album"
    _copy(folder / "01 - One.flac", "flac")
    _copy(folder / "disc2" / "02 - Two.WAV", "wav")
    (folder / "cover.jpg").write_bytes(b"jpg")
    (folder / "notes.txt").write_text("x")
    _copy(folder / "._01 - One.flac", "flac")  # AppleDouble junk
    _copy(folder / ".hidden" / "x.mp3")

    result = drop_import(db, [str(single), str(folder)])

    assert result.failed == 0, result.error_messages
    assert result.imported == 3
    assert result.ignored == 2
    assert result.skipped == 0
    names = {t.filename for t in db.query(Track)}
    assert names == {
        str(single.resolve()),
        str((folder / "01 - One.flac").resolve()),
        str((folder / "disc2" / "02 - Two.WAV").resolve()),
    }
    # filenames above are the dropped paths themselves: imported in place
    assert sorted(result.track_ids) == sorted(t.id for t in db.query(Track))
    track = db.query(Track).filter(Track.filename == str(single.resolve())).one()
    assert (track.artist, track.title) == ("Artist", "Single")
    # same pipeline: waveform + analysis + stems queued
    types = {t.type for t in db.query(Task)}
    assert {"stem-split"} <= types
    assert len(types) >= 2


def test_already_in_library_skipped_including_archived(db, make_track, tmp_path):
    active = _copy(tmp_path / "a.mp3")
    archived = _copy(tmp_path / "b.mp3")
    new = _copy(tmp_path / "c.mp3")
    make_track(filename=str(active.resolve()))
    make_track(filename=str(archived.resolve()), archived_at=datetime.now())

    result = drop_import(db, [str(tmp_path), str(new)])

    assert result.imported == 1
    assert result.skipped == 2
    assert db.query(Track).count() == 3


def test_missing_path_counts_as_failed(db, tmp_path):
    result = drop_import(db, [str(tmp_path / "gone.mp3")])
    assert (result.imported, result.failed) == (0, 1)
    assert "not found" in result.error_messages[0]


def test_bulk_drop_above_guard_enqueues_no_stems(db, tmp_path):
    for i in range(4):
        _copy(tmp_path / f"t{i}.mp3")
    result = drop_import(db, [str(tmp_path)], stem_guard=3)
    assert result.imported == 4
    assert db.query(Task).filter(Task.type == "stem-split").count() == 0


def test_small_drop_enqueues_stems(db, tmp_path):
    for i in range(3):
        _copy(tmp_path / f"t{i}.mp3")
    drop_import(db, [str(tmp_path)], stem_guard=3)
    assert db.query(Task).filter(Task.type == "stem-split").count() == 3


def test_drop_onto_playlist_appends_imported(db, make_track, tmp_path):
    playlist = Playlist(name="P")
    db.add(playlist)
    db.commit()
    first = make_track()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=first.id, position=0))
    db.commit()
    _copy(tmp_path / "x.mp3")
    _copy(tmp_path / "y.mp3")

    result = drop_import(db, [str(tmp_path)], playlist_id=playlist.id)

    assert result.playlist_added == 2
    entries = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == playlist.id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    assert [e.track_id for e in entries] == [first.id, *result.track_ids]


def test_unknown_playlist_raises(db, tmp_path):
    with pytest.raises(LookupError):
        drop_import(db, [str(tmp_path)], playlist_id=999)


def test_router(db, tmp_path):
    _copy(tmp_path / "r.mp3")
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        resp = client.post("/api/sync/library/drop-import", json={"paths": [str(tmp_path)]})
        assert resp.status_code == 200, resp.text
        assert resp.json()["imported"] == 1
        resp = client.post(
            "/api/sync/library/drop-import",
            json={"paths": [str(tmp_path)], "playlist_id": 12345},
        )
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()

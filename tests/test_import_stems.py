"""Import entry points must enqueue stems even above the startup backlog guard."""

from types import SimpleNamespace

import pytest

from backend.library.import_manager import LibraryImportManager
from backend.models import Track
from backend.tasks.models import Task
from backend.tracks.executor import import_tracks_from_rekordbox


@pytest.mark.parametrize("derive_provenance", [True, False])
@pytest.mark.parametrize("count", [1, 25])
def test_disk_and_acquisition_imports_enqueue_only_new_tracks(
    db, make_track, audio_file, tmp_path, derive_provenance, count,
):
    existing = make_track()
    for i in range(count):
        audio_file("mp3", f"new-{i}.mp3")
    importer = LibraryImportManager(db, str(tmp_path))
    result = importer.import_tracks(derive_provenance=derive_provenance)
    assert result.errors == 0, result.error_messages
    assert result.imported == count
    new_ids = {t.id for t in db.query(Track) if t.id != existing.id}
    tasks = db.query(Task).filter(Task.type == "stem-split").all()
    assert {t.ref for t in tasks} == {f"track:{id}" for id in new_ids}
    assert len(tasks) == count
    assert all(t.state == "pending" for t in tasks)
    assert importer.import_tracks().imported == 0
    assert db.query(Task).filter(Task.type == "stem-split").count() == count


def test_rekordbox_import_enqueues_stems_but_dry_run_does_not(db, audio_file):
    track = SimpleNamespace(
        FolderPath=str(audio_file()), Title="Imported", BPM=17400, KeyID=None,
    )
    assert import_tracks_from_rekordbox([track], db) == 0
    assert db.query(Task).count() == 0
    assert import_tracks_from_rekordbox([track], db, dry_run=False) == 1
    imported = db.query(Track).one()
    task = db.query(Task).filter(Task.type == "stem-split").one()
    assert task.ref == f"track:{imported.id}"
    assert task.state == "pending"

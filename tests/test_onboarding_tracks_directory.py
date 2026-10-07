"""Add a tracks directory (#276): recursive Scan + in-place Disk Import,
never stems, idempotent; and the sync_library import path no longer drops
subfolder files (ADR 0002: real files, real DB)."""

import shutil

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import models
from backend.database import get_db
from backend.onboarding.tracks_directory import scan_and_import
from backend.tasks.models import Task
from tests.conftest import FIXTURES_DIR


def make_tree(tmp_path):
    root = tmp_path / "Music"
    (root / "House" / "Deep").mkdir(parents=True)
    (root / "DnB").mkdir()
    for rel in ("top.mp3", "House/a.wav", "House/Deep/b.flac", "DnB/c.m4a"):
        src = FIXTURES_DIR / f"silence{(root / rel).suffix}"
        shutil.copy(src, root / rel)
    (root / "notes.txt").write_text("not audio")
    return root


def test_scan_recurses_subfolders_and_imports_in_place(db, tmp_path):
    root = make_tree(tmp_path)
    seen = []
    summary = scan_and_import(db, str(root), progress=lambda *a: seen.append(a))
    assert summary["files_scanned"] == 4
    assert summary["imported"] == 4
    names = sorted(t.filename for t in db.query(models.Track).all())
    assert names == sorted(str(p) for p in root.rglob("*") if p.suffix != ".txt" and p.is_file())
    assert any(phase == "scanning" for phase, *_ in seen)
    assert seen[-1] == ("importing", 4, 4)


def test_scan_never_enqueues_stems_and_is_idempotent(db, tmp_path):
    root = make_tree(tmp_path)
    scan_and_import(db, str(root), progress=lambda *a: None)
    types = {t.type for t in db.query(Task).all()}
    assert "stem-split" not in types
    assert "waveform" in types
    again = scan_and_import(db, str(root), progress=lambda *a: None)
    assert again["imported"] == 0
    assert again["already_in_library"] == 4
    assert db.query(models.Track).count() == 4


def test_sync_library_import_keeps_subfolder_candidates(db, tmp_path, monkeypatch):
    """The old import endpoint re-scanned non-recursively and silently
    dropped every subfolder file listed by the candidates call."""
    from backend.routers import sync_library

    root = make_tree(tmp_path)
    monkeypatch.setattr(
        sync_library,
        "get_config",
        lambda: type("C", (), {"library": type("L", (), {"tracks_directory": str(root)})()})(),
    )
    app = FastAPI()
    app.include_router(sync_library.router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    listed = client.get("/api/sync/library/candidates").json()["candidates"]
    assert len(listed) == 4
    deep = [c["filepath"] for c in listed if "Deep" in c["filepath"]]
    result = client.post("/api/sync/library/import", json={"candidate_filepaths": deep}).json()
    assert result["imported"] == 1

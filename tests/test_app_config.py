"""Data root + settings file + /api/config (packaged-app #277).

MANADJ_DATA_DIR is read at call time, so tests steer everything through the
environment; the get_config() global cache is saved/restored around each test.
"""

import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.config as config_module
from backend.config import load_config
from backend.data_root import (
    PACKAGED_DEFAULT,
    REPO_ROOT,
    data_root,
    db_path,
    settings_file_path,
)
from backend.settings_file import update_settings_file


@pytest.fixture
def temp_data_root(tmp_path, monkeypatch):
    """Point the data root at a tmp dir and isolate the config cache."""
    monkeypatch.setenv("MANADJ_DATA_DIR", str(tmp_path))
    saved = config_module._config
    config_module._config = None
    # Rekordbox auto-detect is machine-dependent; pin it to "not installed".
    monkeypatch.setattr(
        config_module, "REKORDBOX_DEFAULT_LOCATION", tmp_path / "no-rekordbox"
    )
    yield tmp_path
    config_module._config = saved


# -- data root resolution ----------------------------------------------------


def test_data_root_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("MANADJ_DATA_DIR", str(tmp_path))
    assert data_root() == tmp_path
    assert settings_file_path() == tmp_path / "config.toml"
    assert db_path() == tmp_path / "data" / "library.db"


def test_data_root_packaged_default(monkeypatch):
    monkeypatch.delenv("MANADJ_DATA_DIR", raising=False)
    monkeypatch.setenv("MANADJ_PACKAGED", "1")
    assert data_root() == PACKAGED_DEFAULT


def test_data_root_dev_default(monkeypatch):
    monkeypatch.delenv("MANADJ_DATA_DIR", raising=False)
    monkeypatch.delenv("MANADJ_PACKAGED", raising=False)
    assert data_root() == REPO_ROOT


# -- settings file round trip ------------------------------------------------


def test_fresh_settings_file_from_template(temp_data_root):
    update_settings_file({"tracks_directory": "/music"})
    text = settings_file_path().read_text()
    # Human-readable: the template's comments survive the first write.
    assert "# manaDJ settings file." in text
    cfg = load_config()
    assert cfg.library.tracks_directory == "/music"
    assert cfg.export.enabled is False  # default off (ADR 0043)


def test_hand_edits_survive_ui_writes(temp_data_root):
    settings_file_path().write_text(
        "# my precious comment\n"
        "[library]\n"
        'tracks_directory = "/old"\n'
        "\n"
        "[soulseek]\n"
        'slskd_url = "http://localhost:5030"\n'
    )
    update_settings_file({"tracks_directory": "/new", "export_enabled": True})
    text = settings_file_path().read_text()
    assert "# my precious comment" in text
    assert 'slskd_url = "http://localhost:5030"' in text
    cfg = load_config()
    assert cfg.library.tracks_directory == "/new"
    assert cfg.export.enabled is True


def test_clearing_rekordbox_path_restores_autodetect(temp_data_root):
    import tomllib

    update_settings_file({"rekordbox_path": "/custom/rekordbox"})
    assert 'rekordbox_path = "/custom/rekordbox"' in settings_file_path().read_text()
    update_settings_file({"rekordbox_path": ""})
    data = tomllib.loads(settings_file_path().read_text())
    assert "rekordbox_path" not in data.get("database", {})


def test_rekordbox_autodetect_default(temp_data_root):
    detected = temp_data_root / "no-rekordbox"
    detected.mkdir()  # pinned detect location now "exists"
    cfg = load_config()
    assert cfg.database.rekordbox_path == str(detected)
    assert cfg.database.rekordbox_autodetected is True


def test_explicit_empty_rekordbox_disables(temp_data_root):
    (temp_data_root / "no-rekordbox").mkdir()
    settings_file_path().write_text('[database]\nrekordbox_path = ""\n')
    cfg = load_config()
    assert cfg.database.rekordbox_path is None
    assert cfg.database.rekordbox_autodetected is False


# -- /api/config router ------------------------------------------------------


@pytest.fixture
def client(temp_data_root):
    from backend.routers import app_config

    app = FastAPI()
    app.include_router(app_config.router, prefix="/api/config")
    return TestClient(app)


def test_get_defaults(client, temp_data_root):
    body = client.get("/api/config").json()
    assert body["tracks_directory"] is None
    assert body["export_enabled"] is False
    assert body["settings_file"] == str(temp_data_root / "config.toml")


def test_put_persists_and_reloads(client, temp_data_root):
    body = client.put(
        "/api/config",
        json={"tracks_directory": "/music", "export_enabled": True},
    ).json()
    assert body["tracks_directory"] == "/music"
    assert body["export_enabled"] is True
    # Persisted as TOML in the data root; a fresh GET agrees.
    assert '"/music"' in (temp_data_root / "config.toml").read_text()
    assert client.get("/api/config").json()["tracks_directory"] == "/music"


def test_put_untouched_fields_stay(client):
    client.put("/api/config", json={"tracks_directory": "/music"})
    body = client.put("/api/config", json={"export_enabled": True}).json()
    assert body["tracks_directory"] == "/music"


# -- export gate -------------------------------------------------------------


def test_export_gate_403_when_disabled(temp_data_root, monkeypatch):
    from backend.routers import sync_export

    app = FastAPI()
    app.include_router(sync_export.router, prefix="/api")
    res = TestClient(app).post(
        "/api/sync/export/key/rekordbox", json={"track_id": 1}
    )
    assert res.status_code == 403
    assert "Settings" in res.json()["detail"]


def test_export_gate_open_when_enabled(temp_data_root):
    """With export on, the gate passes and the next dependency (Rekordbox
    availability) answers instead."""
    from backend.routers import sync_export

    update_settings_file({"export_enabled": True})
    config_module.reload_config()
    app = FastAPI()
    app.include_router(sync_export.router, prefix="/api")
    res = TestClient(app).post(
        "/api/sync/export/key/rekordbox", json={"track_id": 1}
    )
    assert res.status_code == 503  # Rekordbox library not available


def test_db_backup_env_data_dir(monkeypatch, tmp_path):
    """db_backup's defaults follow MANADJ_DATA_DIR (works for any data root)."""
    import importlib
    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent / "scripts" / "agent"))
    try:
        import db_backup

        monkeypatch.setenv("MANADJ_DATA_DIR", str(tmp_path))
        module = importlib.reload(db_backup)
        assert module.REAL_DB == tmp_path / "data" / "library.db"
        assert module.BACKUP_DIR == tmp_path / "data" / "backups"
        monkeypatch.delenv("MANADJ_DATA_DIR")
        importlib.reload(module)  # restore real defaults for other tests
    finally:
        sys.path.pop(0)


def test_db_backup_explicit_paths(tmp_path):
    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent / "scripts" / "agent"))
    try:
        import db_backup
    finally:
        sys.path.pop(0)

    db = tmp_path / "library.db"
    db.write_text("decoy database")  # decoy file only — never a real asset
    backups = tmp_path / "backups"
    dest = db_backup.backup(force=True, quiet=True, db=db, backup_dir=backups)
    assert dest is not None and dest.parent == backups
    assert dest.read_text() == "decoy database"

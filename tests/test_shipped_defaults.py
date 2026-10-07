"""Shipped defaults (setup-guides #293): loader filtering, config layering,
the /defaults endpoint, and the read-only snapshot script (decoy DB only)."""

import importlib.util
import json
import sqlite3
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import shipped_defaults
from backend.config import _classification_config, _download_delay_secs
from backend.routers import settings

ROOT = Path(__file__).parent.parent


def _snapshot_module():
    spec = importlib.util.spec_from_file_location(
        "snapshot_defaults", ROOT / "scripts" / "settings" / "snapshot_defaults.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_committed_file_excludes_routing_paths_and_tokens():
    raw = json.loads(shipped_defaults.DEFAULTS_PATH.read_text())
    assert "manadj-audio-routing" not in raw["settings"]
    assert all(shipped_defaults.is_shipped_setting(k) for k in raw["settings"])
    text = json.dumps(raw["config"])
    for forbidden in ("tracks_directory", "rekordbox_path", "engine_dj_path", "oauth_token", "slskd", "/Users/"):
        assert forbidden not in text


def test_load_drops_unlisted_keys(tmp_path):
    path = tmp_path / "defaults.json"
    path.write_text(json.dumps({
        "settings": {"manadj-quantize": "true", "manadj-audio-routing": "{}", "manadj-app-mode": "perf"},
        "config": {"library": {"tracks_directory": "/x"}, "acquisition": {"download_delay_secs": 7}},
    }))
    loaded = shipped_defaults.load(path)
    assert loaded["settings"] == {"manadj-quantize": "true"}
    assert loaded["config"] == {"acquisition": {"download_delay_secs": 7}}


def test_missing_file_is_empty(tmp_path):
    assert shipped_defaults.load(tmp_path / "nope.json") == {"settings": {}, "config": {}}


def test_config_file_wins_and_shipped_fills_unset():
    shipped = {"acquisition": {"download_delay_secs": 9, "classification": {"clip_max_duration_secs": 60, "mix_min_duration_secs": 999}}}
    data = shipped_defaults.merge_under({"acquisition": {"classification": {"clip_max_duration_secs": 30}}}, shipped)
    assert _download_delay_secs(data) == 9
    classification = _classification_config(data)
    assert classification.clip_max_duration_secs == 30
    assert classification.mix_min_duration_secs == 999


def test_defaults_endpoint(monkeypatch):
    monkeypatch.setattr(shipped_defaults, "shipped_settings", lambda: {"manadj-quantize": "true"})
    app = FastAPI()
    app.include_router(settings.router, prefix="/api/settings")
    resp = TestClient(app).get("/api/settings/defaults")
    assert resp.json() == {"defaults": {"manadj-quantize": "true"}}


def test_snapshot_reads_decoy_db_read_only(tmp_path):
    db = tmp_path / "decoy.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
    conn.executemany("INSERT INTO settings VALUES (?, ?)", [
        ("manadj-quantize", "true"),
        ("manadj-audio-routing", '{"master":"device-id"}'),
        ("manadj-visualizer-params:neon", '{"speed":2}'),
        ("manadj-last-pair", "1:2"),
    ])
    conn.commit()
    conn.close()
    before = db.read_bytes()
    config = tmp_path / "config.toml"
    config.write_text('[library]\ntracks_directory = "/music"\n[acquisition]\ndownload_delay_secs = 4\n')

    payload = json.loads(_snapshot_module().snapshot(db, config))

    assert payload["settings"] == {
        "manadj-quantize": "true",
        "manadj-visualizer-params:neon": '{"speed":2}',
        **shipped_defaults.SETTING_OVERRIDES,
    }
    assert payload["config"] == {"acquisition": {"download_delay_secs": 4}}
    assert db.read_bytes() == before


def test_new_users_start_with_two_decks():
    # setup-guides #301: deliberate override of the snapshot (Murtaza runs 4).
    raw = json.loads(shipped_defaults.DEFAULTS_PATH.read_text())
    assert raw["settings"]["manadj-perf-deck-count"] == "2"

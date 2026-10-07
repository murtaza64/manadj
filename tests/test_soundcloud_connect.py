"""SoundCloud connect (setup-guides #290): token precedence, normalization,
validation, and the /api/soundcloud guide API. SoundCloud itself is faked
(validate swapped); the real GET /me call is a thin adapter."""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import config as config_module
from backend.acquisition import connect_router
from backend.acquisition.connect import SoundCloudAccount, TokenRejected, get_token_store, normalize_token

GOOD = "2-123456-987654-AbCdEfGhIjKlMn"


def fake_validate(token: str) -> SoundCloudAccount:
    if token == GOOD:
        return SoundCloudAccount(username="djalice", likes_count=1234)
    if token == "offline":
        raise requests.ConnectionError("down")
    raise TokenRejected("SoundCloud rejected the token (HTTP 401)")


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    monkeypatch.setenv("MANADJ_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("SOUNDCLOUD_OAUTH_TOKEN", raising=False)
    monkeypatch.setattr(config_module, "_load_dotenv", lambda: None)
    monkeypatch.setattr(connect_router, "validate", fake_validate)
    monkeypatch.setattr(connect_router, "_cache", {})
    config_module.reload_config()
    yield tmp_path
    monkeypatch.undo()
    config_module.reload_config()


@pytest.fixture
def client(env: Path) -> TestClient:
    app = FastAPI()
    app.include_router(connect_router.router, prefix="/api/soundcloud")
    return TestClient(app)


@pytest.mark.parametrize("raw", [GOOD, f"  {GOOD}\n", f'"{GOOD}"', f"OAuth {GOOD}", f"oauth_token={GOOD}"])
def test_normalize_token(raw: str) -> None:
    assert normalize_token(raw) == GOOD


def test_token_sources(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = env / "data"
    root.mkdir()
    (root / "config.toml").write_text('[soundcloud]\noauth_token = "fromconfig"\n')
    sc = config_module.reload_config().soundcloud
    assert (sc.oauth_token, sc.token_source) == ("fromconfig", "config")
    get_token_store().save("stored")  # the guide: data-root .env, beats the settings file
    sc = config_module.reload_config().soundcloud
    assert (sc.oauth_token, sc.token_source) == ("stored", "secrets")
    assert "SOUNDCLOUD_OAUTH_TOKEN=stored" in (root / ".env").read_text()
    monkeypatch.setenv("SOUNDCLOUD_OAUTH_TOKEN", "fromenv")
    sc = config_module.reload_config().soundcloud
    assert (sc.oauth_token, sc.token_source) == ("fromenv", "env")


def test_connect_flow(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    connected: list[bool] = []
    monkeypatch.setattr(connect_router, "on_connected", lambda: connected.append(True))
    assert client.get("/api/soundcloud/status").json() == {
        "connected": False, "token_source": None, "account": None, "error": None,
    }

    r = client.put("/api/soundcloud/token", json={"token": "bad"})
    assert r.status_code == 400 and "rejected" in r.json()["detail"]
    assert get_token_store().load() is None and connected == []

    st = client.put("/api/soundcloud/token", json={"token": f"OAuth {GOOD} "}).json()
    assert st == {
        "connected": True, "token_source": "secrets",
        "account": {"username": "djalice", "likes_count": 1234}, "error": None,
    }
    assert get_token_store().load() == GOOD
    assert config_module.get_config().soundcloud.oauth_token == GOOD
    assert connected == [True]

    st = client.delete("/api/soundcloud/token").json()
    assert st["connected"] is False and get_token_store().load() is None
    assert "SOUNDCLOUD_OAUTH_TOKEN" not in os.environ


def test_stored_token_rejected_later_reports_error(client: TestClient) -> None:
    get_token_store().save("expired")
    config_module.reload_config()
    st = client.get("/api/soundcloud/status").json()
    assert st["connected"] is False and st["token_source"] == "secrets"
    assert "expired" in st["error"]


def test_network_error_is_not_cached(client: TestClient) -> None:
    r = client.put("/api/soundcloud/token", json={"token": "offline"})
    assert r.status_code == 400 and "Couldn't reach SoundCloud" in r.json()["detail"]
    assert "offline" not in connect_router._cache


def test_env_token_blocks_guide(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOUNDCLOUD_OAUTH_TOKEN", GOOD)
    config_module.reload_config()
    st = client.get("/api/soundcloud/status").json()
    assert st["connected"] and st["token_source"] == "env"
    assert client.put("/api/soundcloud/token", json={"token": GOOD}).status_code == 409

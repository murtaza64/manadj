"""SPA serving (backend/spa.py, packaged-app #279).

Builds a minimal app (ADR-0002 — importing backend.main would pull the
analysis stack) with one API route and a temp dist, and checks the routing
contract: API wins, real files served, everything else falls back to
index.html.
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.spa import frontend_dist, mount_spa


@pytest.fixture()
def dist(tmp_path: Path) -> Path:
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>manaDJ</title>")
    (d / "vite.svg").write_text("<svg/>")
    (d / "assets" / "index-abc123.js").write_text("console.log('app')")
    return d


@pytest.fixture()
def client(dist: Path) -> TestClient:
    app = FastAPI()

    @app.get("/api/ping")
    def ping():
        return {"ok": True}

    mount_spa(app, dist)
    return TestClient(app)


def test_api_routes_win_over_catch_all(client: TestClient):
    assert client.get("/api/ping").json() == {"ok": True}


def test_root_serves_index(client: TestClient):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "manaDJ" in resp.text


def test_spa_route_falls_back_to_index(client: TestClient):
    # Deep link / hard reload on a client route (e.g. /midi-inspect).
    resp = client.get("/midi-inspect")
    assert resp.status_code == 200
    assert "manaDJ" in resp.text


def test_real_files_served_verbatim(client: TestClient):
    assert client.get("/vite.svg").text == "<svg/>"
    assert "console.log" in client.get("/assets/index-abc123.js").text


def test_missing_asset_is_404_not_index(client: TestClient):
    # A stale chunk reference must fail loudly, not load index.html as JS.
    assert client.get("/assets/index-gone.js").status_code == 404


def test_no_path_traversal(client: TestClient, dist: Path, tmp_path: Path):
    (tmp_path / "secret.txt").write_text("nope")
    resp = client.get("/%2e%2e/secret.txt")
    assert "nope" not in resp.text


def test_frontend_dist_env_override(dist: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MANADJ_FRONTEND_DIST", str(dist))
    assert frontend_dist() == dist.resolve()


def test_frontend_dist_requires_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # A half-built dist (no index.html) serves nothing.
    monkeypatch.setenv("MANADJ_FRONTEND_DIST", str(tmp_path))
    assert frontend_dist() is None

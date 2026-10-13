"""Shell shutdown hook (backend/serve.py, #314)."""

import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.serve import SHUTDOWN_PATH, install_shutdown_route
from backend.spa import mount_spa


def _app(tmp_path):
    app = FastAPI()
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>")
    mount_spa(app, dist)  # catch-all registered first, like backend.main
    server = uvicorn.Server(uvicorn.Config(app))
    install_shutdown_route(app, server, "s3cret")
    return app, server


def test_shutdown_requires_token(tmp_path):
    app, server = _app(tmp_path)
    client = TestClient(app)
    assert client.post(SHUTDOWN_PATH).status_code == 403
    assert client.post(SHUTDOWN_PATH, headers={"X-Manadj-Shell-Token": "nope"}).status_code == 403
    assert server.should_exit is False


def test_shutdown_with_token_stops_server(tmp_path):
    app, server = _app(tmp_path)
    resp = TestClient(app).post(SHUTDOWN_PATH, headers={"X-Manadj-Shell-Token": "s3cret"})
    assert resp.status_code == 202
    assert server.should_exit is True


def test_get_still_hits_spa(tmp_path):
    app, _ = _app(tmp_path)
    assert TestClient(app).get(SHUTDOWN_PATH).status_code == 200  # SPA fallback, not the hook


def test_lifeline_eof_stops_server():
    import io

    from backend.serve import watch_lifeline

    server = uvicorn.Server(uvicorn.Config(FastAPI()))
    watch_lifeline(server, io.StringIO("")).join(timeout=2)
    assert server.should_exit is True

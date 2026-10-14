"""Phone sync LAN listener (#373): device-sync only, behind a pairing code."""

import socket

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import device_listener
from backend.database import get_db
from backend.device_listener import PAIR_HEADER, PAIR_SECRET, DeviceListener, build_app, normalize_code
from backend.routers import device_listener as control


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    monkeypatch.setenv("MANADJ_DATA_DIR", str(tmp_path))
    monkeypatch.delenv(PAIR_SECRET, raising=False)
    yield tmp_path
    device_listener.stop()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def lan_client(db):
    app = build_app(lambda: "ABCDE-FGHJK")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_pairing_required(lan_client):
    assert lan_client.get("/api/device-sync/snapshot").status_code == 401
    assert lan_client.get("/api/device-sync/snapshot", headers={PAIR_HEADER: "WRONG-CODE0"}).status_code == 401
    ok = lan_client.get("/api/device-sync/snapshot", headers={PAIR_HEADER: "abcde fghjk"})
    assert ok.status_code == 200 and ok.json()["version"] == 1


def test_only_device_sync_is_exposed(lan_client):
    headers = {PAIR_HEADER: "ABCDE-FGHJK"}
    assert lan_client.get("/api/tracks/", headers=headers).status_code == 404
    assert lan_client.get("/api/config", headers=headers).status_code == 404
    assert lan_client.get("/docs", headers=headers).status_code == 404


def test_repeated_failures_rate_limited(lan_client):
    for _ in range(device_listener.MAX_FAILURES):
        assert lan_client.get("/api/device-sync/snapshot").status_code == 401
    good = lan_client.get("/api/device-sync/snapshot", headers={PAIR_HEADER: "ABCDE-FGHJK"})
    assert good.status_code == 429


def test_codes_are_unambiguous():
    code = device_listener.new_pair_code()
    assert len(normalize_code(code)) == 10 and code[5] == "-"
    assert not set(normalize_code(code)) & set("01OI")


def test_listener_serves_on_real_socket(tmp_path, db):
    listener = DeviceListener(host="127.0.0.1")
    port = _free_port()
    listener.start(port, lambda: "ABCDE-FGHJK")
    try:
        assert listener.running
        assert requests.get(f"http://127.0.0.1:{port}/api/device-sync/snapshot", timeout=5).status_code == 401
    finally:
        listener.stop()
    assert not listener.running


def test_port_in_use_reports_error():
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        listener = DeviceListener(host="127.0.0.1")
        listener.start(port, lambda: "X")
        assert not listener.running
        assert listener.error
        listener.stop()


def test_control_enables_persists_and_rotates(data_root, monkeypatch):
    port = _free_port()
    monkeypatch.setattr(device_listener, "_listener", DeviceListener(host="127.0.0.1"))
    app = FastAPI()
    app.include_router(control.router, prefix="/api/device-listener")
    client = TestClient(app)

    off = client.get("/api/device-listener").json()
    assert off["enabled"] is False and off["pair_code"] is None and off["running"] is False

    on = client.put("/api/device-listener", json={"enabled": True, "port": port}).json()
    assert on["enabled"] and on["running"] and on["port"] == port
    code = on["pair_code"]
    assert code and (data_root / ".env").read_text().count(PAIR_SECRET) == 1
    assert "[device_sync]" in (data_root / "config.toml").read_text()

    rotated = client.post("/api/device-listener/rotate").json()
    assert rotated["pair_code"] != code

    off = client.put("/api/device-listener", json={"enabled": False}).json()
    assert off["running"] is False
    assert client.post("/api/device-listener/rotate").status_code == 409

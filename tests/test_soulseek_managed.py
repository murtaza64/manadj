"""Managed slskd (setup-guides #291): config precedence, generated config,
supervision, and the /api/soulseek guide API.

The slskd binary is a DECOY: a tiny python script that parses the generated
config for its web port and answers /api/v0/server like slskd does. It is
launched through the supervisor's `popen` seam as `[sys.executable, script,
...]` — never via its shebang (Windows can't exec scripts; CI runners' system
python3 is slow or absent, #333). Real slskd behaviour (0.26.0) was verified
live; see backend/soulseek/.
"""

import json
import os
import stat
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import psutil
import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import config as config_module
from backend.config import _load_dotenv as REAL_LOAD_DOTENV
from backend.soulseek import managed, supervisor
from backend.soulseek import router as soulseek_router
from backend.soulseek.managed import _ENV_KEYS, new_managed, render_slskd_config
from backend.soulseek.supervisor import SlskdSupervisor

FAKE_SLSKD = r'''import http.server, json, os, re, socketserver, sys
args = sys.argv[1:]
cfg = open(args[args.index("--config") + 1]).read()
port = int(re.search(r"^  port: (\d+)$", cfg, re.M).group(1))
user = re.search(r'^  username: "(.*)"$', cfg.split("soulseek:")[1], re.M).group(1)
if os.environ.get("FAKE_SLSKD_CRASH"):
    print("[00:00:00 FTL] boom", flush=True)
    sys.exit(3)
logged_in = user != "wrong"
if not logged_in:
    print("[00:00:01 WRN] Failed to log in: INVALIDPASS", flush=True)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"state": "Connected, LoggedIn" if logged_in else "Disconnected",
                           "isConnected": logged_in, "isLoggedIn": logged_in}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
class Server(http.server.HTTPServer):
    # HTTPServer.server_bind does a reverse-DNS socket.getfqdn(), which
    # stalls for many seconds on CI macOS runners (#333).
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "localhost", port
Server(("127.0.0.1", port), H).serve_forever()
'''


def python_popen(args: list[str], **kwargs):  # type: ignore[no-untyped-def]
    """Run the decoy script with this interpreter, whatever the OS."""
    return subprocess.Popen([sys.executable, *args], **kwargs)


def make_supervisor(binary: Path | None) -> SlskdSupervisor:
    return SlskdSupervisor(binary, managed.slskd_app_dir(), managed.get_store(), popen=python_popen)


@pytest.fixture
def fake_binary(tmp_path: Path) -> Path:
    path = tmp_path / "bundle" / ("slskd.exe" if sys.platform == "win32" else "slskd")
    path.parent.mkdir()
    path.write_text(FAKE_SLSKD, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


@pytest.fixture
def env(tmp_path: Path, fake_binary: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Isolated data root + decoy binary; no external slskd, no .env."""
    data = tmp_path / "data"
    monkeypatch.setenv("MANADJ_DATA_DIR", str(data))
    monkeypatch.setenv(managed.SLSKD_BIN_ENV, str(fake_binary))
    monkeypatch.delenv("SLSKD_API_KEY", raising=False)
    for key in _ENV_KEYS.values():
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(config_module, "_load_dotenv", lambda: None)
    # the router reaches the supervisor through get_supervisor()
    monkeypatch.setattr(supervisor, "_supervisor", make_supervisor(fake_binary))
    config_module.reload_config()
    yield data
    if supervisor._supervisor is not None:
        supervisor._supervisor.stop()
    monkeypatch.undo()
    config_module.reload_config()


def external_slskd(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A user-run slskd: [soulseek] slskd_url in the settings file + SLSKD_API_KEY."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "config.toml").write_text('[soulseek]\nslskd_url = "http://localhost:5030"\n')
    monkeypatch.setenv("SLSKD_API_KEY", "external-key-0123456789")


def wait_for(predicate, timeout: float = 10.0):  # type: ignore[no-untyped-def]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError("timed out")


# --- generated config / store ------------------------------------------------

def test_render_config_is_loopback_with_admin_key(tmp_path: Path) -> None:
    m = new_managed("alice", 'pa"ss')
    text = render_slskd_config(m, tmp_path)
    assert 'ip_address: "127.0.0.1"' in text
    assert "disabled: true" in text  # https off
    assert f"key: {json.dumps(m.api_key)}" in text
    assert "role: administrator" in text
    assert 'password: "pa\\"ss"' in text  # quoted safely
    assert "directories: []" in text  # no shares


def test_new_managed_reuses_generated_values() -> None:
    first = new_managed("alice", "a")
    again = new_managed("bob", "b", first)
    assert (again.username, again.password) == ("bob", "b")
    assert (again.api_key, again.web_port, again.listen_port) == (first.api_key, first.web_port, first.listen_port)


def test_store_roundtrip_in_dotenv(env: Path) -> None:
    dotenv = env / ".env"
    dotenv.parent.mkdir(parents=True)
    dotenv.write_text("# mine\nSOUNDCLOUD_OAUTH_TOKEN=keep\n")
    store = managed.get_store()
    assert store.load() is None
    m = new_managed("alice", "p a#ss")
    store.save(m)
    assert store.load() == m
    text = dotenv.read_text()
    assert "SOUNDCLOUD_OAUTH_TOKEN=keep" in text and "# mine" in text
    assert 'SOULSEEK_PASSWORD="p a#ss"' in text
    if sys.platform != "win32":  # Windows has no POSIX mode bits
        assert stat.S_IMODE(os.stat(dotenv).st_mode) == 0o600
    # a fresh process reads it back through load_config's .env loading
    for key in _ENV_KEYS.values():
        os.environ.pop(key)
    assert store.load() is None
    REAL_LOAD_DOTENV()
    assert store.load() == m
    store.clear()
    assert store.load() is None
    assert "SOULSEEK" not in dotenv.read_text() and "SOUNDCLOUD_OAUTH_TOKEN=keep" in dotenv.read_text()


def test_resolve_binary_env_contract(env: Path, fake_binary: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert managed.resolve_binary() == fake_binary
    monkeypatch.setenv(managed.SLSKD_BIN_ENV, str(fake_binary.parent / "missing"))
    monkeypatch.setattr(managed, "REPO_ROOT", fake_binary.parent / "norepo")
    assert managed.resolve_binary() is None


# --- config precedence ---------------------------------------------------------

def test_config_managed_fallback_and_external_precedence(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert not config_module.reload_config().soulseek.configured
    m = new_managed("alice", "a")
    managed.get_store().save(m)
    cfg = config_module.reload_config().soulseek
    assert cfg.managed and cfg.slskd_url == m.url and cfg.api_key == m.api_key
    external_slskd(env, monkeypatch)
    cfg = config_module.reload_config().soulseek
    # the user's slskd wins over the managed one
    assert cfg.configured and not cfg.managed


# --- supervisor -----------------------------------------------------------------

def test_supervisor_start_health_stop(env: Path, fake_binary: Path) -> None:
    store = managed.get_store()
    sup = make_supervisor(fake_binary)
    assert sup.start() is False  # no credentials yet
    store.save(new_managed("alice", "a"))
    assert sup.start() is True
    st = wait_for(lambda: (s := sup.status()).process == "running" and s)
    assert st.server is not None and st.server.logged_in
    assert (managed.slskd_app_dir() / "slskd.yml").exists()
    pid = st.pid
    sup.stop()
    assert sup.status().process == "stopped"
    assert pid is not None and not psutil.pid_exists(pid)


def test_supervisor_surfaces_login_issue(env: Path, fake_binary: Path) -> None:
    store = managed.get_store()
    store.save(new_managed("wrong", "a"))
    sup = make_supervisor(fake_binary)
    sup.start()
    st = wait_for(lambda: (s := sup.status()).server is not None and s)
    assert not st.server.logged_in
    assert st.last_issue == "Failed to log in: INVALIDPASS"
    sup.stop()


def test_supervisor_gives_up_after_crashes(env: Path, fake_binary: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_SLSKD_CRASH", "1")
    monkeypatch.setattr(supervisor, "MAX_CRASH_RESTARTS", 1)
    monkeypatch.setattr(supervisor.time, "sleep", lambda _s: None)
    store = managed.get_store()
    store.save(new_managed("alice", "a"))
    sup = make_supervisor(fake_binary)
    sup.start()
    st = wait_for(lambda: (s := sup.status()).process == "crashed" and s)
    assert st.exit_code == 3
    assert st.last_issue == "boom"


def test_supervisor_moves_taken_port(env: Path, fake_binary: Path) -> None:
    import socket

    store = managed.get_store()
    with socket.socket() as blocker:
        blocker.bind(("127.0.0.1", 0))
        blocker.listen()
        m = new_managed("alice", "a")
        m.web_port = blocker.getsockname()[1]
        store.save(m)
        sup = make_supervisor(fake_binary)
        sup.start()
        moved = store.load()
        assert moved is not None and moved.web_port != m.web_port
        wait_for(lambda: sup.status().process == "running")
        sup.stop()


# --- router -----------------------------------------------------------------------

@pytest.fixture
def client(env: Path) -> TestClient:
    app = FastAPI()
    app.include_router(soulseek_router.router, prefix="/api/soulseek")
    return TestClient(app)


def env_root(_client: TestClient) -> Path:
    return Path(os.environ["MANADJ_DATA_DIR"])


def test_router_guide_flow(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    configured: list[bool] = []
    monkeypatch.setattr(soulseek_router, "on_configured", lambda: configured.append(True))

    st = client.get("/api/soulseek/status").json()
    assert st["mode"] == "unconfigured" and st["binary_available"]
    assert st["licence"]["license"] == "AGPL-3.0"

    st = client.put("/api/soulseek/credentials", json={"username": "alice", "password": "pw"}).json()
    assert st["mode"] == "managed" and st["username"] == "alice"
    assert configured == [True]
    st = wait_for(lambda: (s := client.get("/api/soulseek/status").json())["server"] and s)
    assert st["server"]["logged_in"] and st["process"] == "running" and st["issue"] is None
    # the Supplier now talks to the managed instance
    url = config_module.get_config().soulseek.slskd_url
    assert requests.get(f"{url}/api/v0/server", timeout=2).json()["isLoggedIn"]

    st = client.delete("/api/soulseek/credentials").json()
    assert st["mode"] == "unconfigured" and st["username"] is None
    assert not (managed.slskd_app_dir() / "slskd.yml").exists()
    assert "SOULSEEK_PASSWORD" not in (env_root(client) / ".env").read_text()
    assert not config_module.get_config().soulseek.configured


def test_router_external_mode_refuses_setup(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    external_slskd(Path(os.environ["MANADJ_DATA_DIR"]), monkeypatch)
    config_module.reload_config()
    assert client.get("/api/soulseek/status").json()["mode"] == "external"
    r = client.put("/api/soulseek/credentials", json={"username": "a", "password": "b"})
    assert r.status_code == 409


def test_router_without_binary(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(managed.SLSKD_BIN_ENV, str(tmp_path / "missing"))
    monkeypatch.setattr(managed, "REPO_ROOT", tmp_path / "norepo")
    assert client.get("/api/soulseek/status").json()["binary_available"] is False
    r = client.put("/api/soulseek/credentials", json={"username": "a", "password": "b"})
    assert r.status_code == 503

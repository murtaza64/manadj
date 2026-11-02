"""Opt-in actual Chromium/WebAudio replay, two disposable migrated libraries.

Run: uv run --with playwright --with pytest -m pytest tests/test_peer_replay_browser.py -q
Requires frontend npm dependencies and a Playwright Chromium installation.
"""
import math
import os
from pathlib import Path
import socket
import struct
import subprocess
import threading
import time
import wave

import httpx
import pytest
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

from tests import test_peer_session_exchange as exchange
from tests.test_peer_history_integration import history
from tests.test_peer_session_exchange import bind, export, post, setup_pair

@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def test_independent_libraries_replay_real_audio_then_refuse_offline_resume(instance, tmp_path):
    browser_api = pytest.importorskip("playwright.sync_api")
    shells = sorted((Path.home() / ".cache/ms-playwright").glob("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"))
    if not shells:
        pytest.skip("Playwright Chromium not installed")
    root = Path(__file__).parents[1]
    if not (root / "frontend/node_modules/.bin/vite").exists():
        pytest.skip("frontend npm dependencies not installed")
    a, b, _, _, sid = setup_pair(instance)
    for peer in (a, b):
        with wave.open(str(peer.root / "generated.wav"), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(8000)
            wav.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * n / 8000))) for n in range(16000)))
    packet = export(a, sid)
    post(b, "imports", packet)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    post(b, f"sessions/{sid}/materialize")
    b = instance("b")  # new engine/application before the browser reads normal history
    from backend.routers.tracks import router as tracks_router
    app = history(b).app
    app.include_router(tracks_router, prefix="/api/tracks")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
    backend_socket = socket.socket()
    backend_socket.bind(("127.0.0.1", 0))
    port = backend_socket.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    worker = threading.Thread(target=server.run, kwargs={"sockets": [backend_socket]}, daemon=True)
    worker.start()
    with socket.socket() as free:
        free.bind(("127.0.0.1", 0))
        frontend_port = free.getsockname()[1]
    log_path = tmp_path / "vite.log"
    env = {**os.environ, "VITE_API_URL": f"http://127.0.0.1:{port}"}
    try:
        with log_path.open("w") as log:
            process = subprocess.Popen([str(root / "frontend/node_modules/.bin/vite"), "--host", "127.0.0.1", "--port", str(frontend_port), "--strictPort"], cwd=root / "frontend", env=env, stdout=log, stderr=log)
        try:
            url = f"http://127.0.0.1:{frontend_port}/tests/peer-replay.html"
            for _ in range(100):
                try:
                    if httpx.get(url).status_code == 200 and server.started:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            else:
                pytest.fail(f"Disposable replay server failed: {log_path.read_text()}")
            with browser_api.sync_playwright() as p:
                browser = p.chromium.launch(executable_path=str(shells[-1]), args=["--autoplay-policy=no-user-gesture-required"], headless=True)
                page = browser.new_page()
                page.goto(url)
                page.wait_for_function("!!window.peerProof")
                result = page.evaluate("sid => window.peerProof.start(sid)", sid)
                assert result["track"] == 9 and result["state"] == "ready", result
                assert result["playing"] and result["playhead"] > 0.05 and result["level"] > 0, result
                assert result["generation"] and result["stopped"] is None, result
                (b.root / "generated.wav").unlink()  # decoy only; cached ready deck must not resume
                assert page.evaluate("() => window.peerProof.resume()") == {"playing": False, "stopped": "load-failed"}
                browser.close()
        finally:
            process.terminate()
            process.wait(timeout=10)
    finally:
        server.should_exit = True
        worker.join(timeout=10)
        backend_socket.close()

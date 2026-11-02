"""Generated-library full frontend host; never imports backend.main or host config."""
from contextlib import contextmanager
from pathlib import Path
import math
import os
import socket
import struct
import subprocess
import threading
import time
import wave

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from backend.peer_sync.router import router as exchange_router
from backend.routers import tracks, settings, tasks, tags, playlists, takes, sets, routine_candidates, routine_takes, routines
from tests.test_peer_history_integration import history


def fixture_app(peer):
    app = history(peer).app
    app.add_middleware(CORSMiddleware, allow_origin_regex=r'http://(127\.0\.0\.1|localhost):\d+', allow_methods=['GET'])
    app.include_router(exchange_router, prefix="/api/peer-sync")
    for module, prefix in [(tracks, 'tracks'), (settings, 'settings'), (tasks, 'tasks'),
                           (tags, 'tags'), (playlists, 'playlists'), (takes, 'takes'), (sets, 'sets'),
                           (routine_candidates, 'routine-candidates'), (routine_takes, 'routine-takes'), (routines, 'routines')]:
        app.include_router(module.router, prefix=f"/api/{prefix}")
    dist = Path(__file__).parents[1] / "frontend/dist"
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')
    app.mount('/fonts', StaticFiles(directory=dist / 'fonts'), name='fonts')
    app.mount('/manual', StaticFiles(directory=dist / 'manual', html=True), name='manual')

    @app.get('/logo.png')
    def logo():
        return FileResponse(dist / 'logo.png')

    @app.get('/')
    def index():
        return FileResponse(dist / 'index.html')

    return app


def generated_audio(*peers):
    for peer in peers:
        with wave.open(str(peer.root / 'generated.wav'), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(8000)
            wav.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 440 * n / 8000))) for n in range(16000)))


@contextmanager
def replay_frontend(backend_url, directory):
    import httpx
    root = Path(__file__).parents[1]
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    url = f'http://127.0.0.1:{port}/tests/peer-replay.html'
    with (directory / 'vite.log').open('w') as log:
        process = subprocess.Popen([str(root / 'frontend/node_modules/.bin/vite'), '--host', '127.0.0.1',
                                    '--port', str(port), '--strictPort'], cwd=root / 'frontend',
                                   env={**os.environ, 'VITE_API_URL': backend_url}, stdout=log, stderr=log)
    try:
        for _ in range(100):
            try:
                if httpx.get(url).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(.1)
        else:
            raise RuntimeError('Replay frontend failed to start')
        yield url
    finally:
        process.terminate()
        process.wait(timeout=10)


@contextmanager
def serving(app):
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    url = f'http://127.0.0.1:{sock.getsockname()[1]}'
    server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(.05)
        else:
            raise RuntimeError('Fixture server did not start')
        yield url
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()

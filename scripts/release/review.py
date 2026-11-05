"""Run the actual notes components/routes with decoy files and no app bootstrap.

uv run scripts/release/review.py --source-revision <full-commit> --state build/notes-review
Both listeners are loopback-only, allocated from free ports. Ctrl-C stops both.
"""

import argparse
import os
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.release_notes import ReleaseNotes, load_release
from backend.routers.release_notes import make_router
from scripts.release.metadata import cut_metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    state = args.state.resolve()
    # Decoy data must stay inside this lane's ignored build tree.
    if not state.is_relative_to(ROOT / "build"):
        parser.error("--state must be inside this checkout's build directory")
    state.mkdir(parents=True, exist_ok=True)
    fixture = state / "fixture"
    fixture.mkdir(exist_ok=True)
    (fixture / "CHANGELOG.md").write_text(
        "## [0.1.0-review.420]\n\n"
        "Sample applied-release notes — not a production update.\n\n"
        "- Notes identify the loaded build, not an offered download.\n"
        "- Done persists an acknowledgement for this release.\n"
        "- Settings can reopen these notes.\n\n"
        "Plain text check: <b>this is not HTML</b>.\n", encoding="utf-8",
    )
    build = cut_metadata(fixture, "0.1.0-review.420", args.source_revision, state / "metadata")
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://localhost:\d+", allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    app.include_router(make_router(ReleaseNotes(load_release(state / "metadata"), state)))
    api_socket = socket.socket()
    api_socket.bind(("127.0.0.1", 0))
    api_port = api_socket.getsockname()[1]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        ui_port = probe.getsockname()[1]
    env = {**os.environ, "VITE_API_URL": f"http://localhost:{api_port}", "VITE_MANADJ_RELEASE_ID": build["release_id"]}
    vite = subprocess.Popen([str(ROOT / "frontend/node_modules/.bin/vite"), "--host", "127.0.0.1", "--port", str(ui_port), "--strictPort"], cwd=ROOT / "frontend", env=env)
    print(f"Review: http://localhost:{ui_port}/release-notes-review.html", flush=True)
    print(f"API: http://localhost:{api_port}/api/release?release_id={build['release_id']}", flush=True)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="info")).run(sockets=[api_socket])
    finally:
        vite.terminate()
        vite.wait(timeout=10)
        api_socket.close()


if __name__ == "__main__":
    main()

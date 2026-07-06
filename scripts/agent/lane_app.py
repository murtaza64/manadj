#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Run the manadj app from a lane workspace, for human review.

Thin daemonizer around scripts/dev.py: reads the lane's port offset from the
main repo's .lanes registry, ensures the sandbox DB clone exists, and runs the
dev processes in the background (PID + logs in .lane-app/, gitignored).

Usage (from inside a lane workspace):
  uv run scripts/agent/lane_app.py start [--backend-port N --vite-port N]
  uv run scripts/agent/lane_app.py status
  uv run scripts/agent/lane_app.py stop

Refuses to run in the default workspace — that is the human's real app
(ports 8000/5173, real DB), managed by hand (docs/agents/parallel-work.md).
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

MAIN_ROOT = Path("/Users/murtaza/manadj/default")
UMBRELLA = MAIN_ROOT.parent
LANE_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = LANE_ROOT / ".lane-app"
PID_FILE = RUNTIME_DIR / "dev.pid"
LOG_FILE = RUNTIME_DIR / "dev.log"


def lane_name() -> str:
    name = LANE_ROOT.name
    prefix = f"{MAIN_ROOT.name}-"
    return name.removeprefix(prefix) if name.startswith(prefix) else name


def registry_ports() -> tuple[int, int] | None:
    """Parse 'backend NNNN, vite NNNN' from this lane's .lanes file."""
    lane_file = UMBRELLA / ".lanes" / f"{lane_name()}.md"
    if not lane_file.exists():
        return None
    m = re.search(r"backend\s+(\d+).*?vite\s+(\d+)", lane_file.read_text())
    return (int(m.group(1)), int(m.group(2))) if m else None


def resolve_ports(args: argparse.Namespace) -> tuple[int, int]:
    if args.backend_port and args.vite_port:
        return args.backend_port, args.vite_port
    ports = registry_ports()
    if ports is None:
        sys.exit(
            f"error: no port entry for lane {lane_name()!r} in "
            f"{MAIN_ROOT / '.lanes'} — pass --backend-port and --vite-port "
            "(and record them in the lane's .lanes file)"
        )
    return ports


def ensure_sandbox_db() -> None:
    db = LANE_ROOT / "data" / "library.db"
    if db.exists():
        return
    real = MAIN_ROOT / "data" / "library.db"
    if not real.exists():
        sys.exit(f"error: real DB not found at {real}")
    db.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cp", "-c", str(real), str(db)], check=True)
    print(f"cloned sandbox DB (APFS) from {real}")


def ensure_frontend_deps() -> None:
    if (LANE_ROOT / "frontend" / "node_modules").is_dir():
        return
    print("installing frontend deps (fresh lane)…")
    subprocess.run(
        ["npm", "install", "--prefix", str(LANE_ROOT / "frontend")], check=True
    )


def running_pid() -> int | None:
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return None


def cmd_start(args: argparse.Namespace) -> None:
    if pid := running_pid():
        sys.exit(f"already running (pid {pid}) — use status/stop")
    backend_port, vite_port = resolve_ports(args)
    ensure_sandbox_db()
    ensure_frontend_deps()
    RUNTIME_DIR.mkdir(exist_ok=True)
    log = open(LOG_FILE, "a")
    proc = subprocess.Popen(
        ["uv", "run", "scripts/dev.py",
         "--backend-port", str(backend_port), "--vite-port", str(vite_port)],
        cwd=LANE_ROOT, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,  # survives this script and the agent session
    )
    PID_FILE.write_text(str(proc.pid))
    (RUNTIME_DIR / "ports").write_text(f"{backend_port} {vite_port}")
    time.sleep(3)
    if proc.poll() is not None:
        PID_FILE.unlink(missing_ok=True)
        sys.exit(f"dev processes exited immediately — see {LOG_FILE}")
    print(f"lane app running: lane={lane_name()} pid={proc.pid}")
    print(f"  browser:       http://localhost:{vite_port}")
    print(f"  desktop shell: npm --prefix {MAIN_ROOT}/desktop start -- --port {vite_port}")
    print(f"  logs:          {LOG_FILE}")


def cmd_status(_args: argparse.Namespace) -> None:
    pid = running_pid()
    if pid is None:
        print(f"lane app not running (lane={lane_name()})")
        return
    try:
        _, vite_port = (RUNTIME_DIR / "ports").read_text().split()
        url = f"http://localhost:{vite_port}"
    except (OSError, ValueError):
        url = "(ports unknown)"
    print(f"lane app running: lane={lane_name()} pid={pid} {url}")


def cmd_stop(_args: argparse.Namespace) -> None:
    pid = running_pid()
    if pid is None:
        sys.exit("not running")
    os.killpg(os.getpgid(pid), signal.SIGTERM)  # dev.py tears down its children
    PID_FILE.unlink(missing_ok=True)
    print(f"stopped (pid {pid})")


def main() -> None:
    if LANE_ROOT == MAIN_ROOT:
        sys.exit(
            "error: refusing to run in the default workspace — it hosts the "
            "human's real app and real DB. Run from a lane workspace."
        )
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    start = sub.add_parser("start")
    start.add_argument("--backend-port", type=int)
    start.add_argument("--vite-port", type=int)
    sub.add_parser("status")
    sub.add_parser("stop")
    args = ap.parse_args()
    {"start": cmd_start, "status": cmd_status, "stop": cmd_stop}[args.cmd](args)


if __name__ == "__main__":
    main()

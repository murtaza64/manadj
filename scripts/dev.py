#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import queue
import signal
import subprocess
import sys
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RESET = "\033[0m"
LABEL_COLORS = {
    "backend": "\033[1;34m",
    "frontend": "\033[1;32m",
    "app": "\033[1;35m",
    "browser": "\033[1;36m",
}

# The shell prefixes forwarded renderer-console lines (desktop/main.js);
# relabel them from [app] to [browser].
BROWSER_PREFIX = "[browser] "


def format_label(name: str, use_color: bool) -> str:
    label = f"[{name}]"
    if not use_color:
        return label
    color = LABEL_COLORS.get(name)
    if color is None:
        return label
    return f"{color}{label}{RESET}"


def spawn_process(
    name: str,
    command: list[str],
    cwd: Path,
    line_queue: queue.Queue[tuple[str, str]],
    env_overrides: dict[str, str] | None = None,
) -> subprocess.Popen[str]:
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)

    if env.get("FORCE_COLOR") == "1":
        env["CLICOLOR_FORCE"] = "1"
        env.pop("NO_COLOR", None)

    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    def stream_logs() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            line_queue.put((name, line.rstrip("\n")))

    threading.Thread(target=stream_logs, daemon=True).start()
    return process


def stop_processes(processes: list[subprocess.Popen[str]]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()

    for process in processes:
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the manadj dev processes.")
    parser.add_argument(
        "--app",
        action="store_true",
        help="also launch the desktop shell; quitting it stops everything",
    )
    parser.add_argument("--backend-port", type=int, default=8000)
    parser.add_argument("--vite-port", type=int, default=5173)
    args = parser.parse_args()

    line_queue: queue.Queue[tuple[str, str]] = queue.Queue()
    shutting_down = False
    use_color = sys.stdout.isatty()

    backend = spawn_process(
        name="backend",
        command=[
            "uv",
            "run",
            "uvicorn",
            "backend.main:app",
            "--reload",
            "--reload-dir",
            "backend",
            "--host",
            "0.0.0.0",
            "--port",
            str(args.backend_port),
        ],
        cwd=ROOT,
        line_queue=line_queue,
        env_overrides={"DISABLE_WAVEFORM_WORKER": "1"},
    )

    frontend = spawn_process(
        name="frontend",
        command=["npm", "run", "dev", "--", "--port", str(args.vite_port), "--strictPort"],
        cwd=ROOT / "frontend",
        line_queue=line_queue,
        env_overrides={
            "FORCE_COLOR": "1",
            "VITE_API_URL": f"http://localhost:{args.backend_port}",
        },
    )

    processes = [backend, frontend]

    if args.app:
        # The shell is attach-only (desktop/README.md): it polls until Vite is
        # up, so spawn order doesn't matter. It is a full peer child — any
        # child exiting (including Cmd+Q on the window) tears everything down.
        #
        # Spawn the Electron binary directly (resolved via electron's own
        # path.txt contract): wrapper layers (npx, cli.js) don't reliably
        # forward SIGTERM, orphaning the window on teardown.
        electron_dir = ROOT / "desktop" / "node_modules" / "electron"
        try:
            electron_bin = electron_dir / "dist" / (
                (electron_dir / "path.txt").read_text().strip()
            )
        except OSError:
            print(
                "electron is not installed — run `make dev-app` (or "
                "`cd desktop && npm install`; see desktop/README.md "
                "troubleshooting if that fails)",
                file=sys.stderr,
            )
            return 1
        app = spawn_process(
            name="app",
            command=[str(electron_bin), ".", "--port", str(args.vite_port)],
            cwd=ROOT / "desktop",
            line_queue=line_queue,
        )
        processes.append(app)

    def handle_signal(_signum: int, _frame: object) -> None:
        nonlocal shutting_down
        shutting_down = True

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    while True:
        try:
            source, line = line_queue.get(timeout=0.1)
            if source == "app" and line.startswith(BROWSER_PREFIX):
                source = "browser"
                line = line[len(BROWSER_PREFIX):]
            print(f"{format_label(source, use_color)} {line}", flush=True)
        except queue.Empty:
            pass

        if shutting_down:
            stop_processes(processes)
            return 0

        for process in processes:
            exit_code = process.poll()
            if exit_code is not None:
                stop_processes(processes)
                return exit_code


if __name__ == "__main__":
    sys.exit(main())

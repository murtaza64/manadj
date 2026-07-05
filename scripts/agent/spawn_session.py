#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Spawn a fresh opencode session on this repo and hand it a task.

Automates the handoff flow (docs/agents/spawn-session.md): the handing-off
agent writes a handoff doc, then runs this script. It creates a session on
the running opencode server, fires the opening prompt asynchronously, and
toasts the user's TUI. It never blocks on, or monitors, the child session.

Usage:
  uv run scripts/agent/spawn_session.py \
      --title "looping: 03-minimal-audible-loop" \
      --handoff .scratch/looping/handoffs/20260705T2100-impl-03.md \
      --task "Implement .scratch/looping/issues/03-minimal-audible-loop.md"

  Workspace: by default the child is told to set up a fresh lane per
  docs/agents/parallel-work.md. Pass --workspace <path> only when handing
  over an existing (quiescent) lane, e.g. the spawner's own.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

FRESH_LANE_INSTRUCTIONS = (
    "Work in a FRESH lane: set up a new jj workspace per "
    "docs/agents/parallel-work.md (register it in .lanes/, APFS-clone the "
    "DB with `cp -c`, never touch other lanes or the default workspace's DB)."
)


def api(port: int, method: str, path: str, body: dict | None = None) -> dict | list | None:
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


def candidate_ports() -> list[int]:
    """LISTEN ports owned by opencode processes, via lsof."""
    out = subprocess.run(
        ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"],
        capture_output=True, text=True,
    ).stdout
    ports: list[int] = []
    for line in out.splitlines()[1:]:
        cols = line.split()
        if len(cols) < 9 or "opencode" not in cols[0].lower():
            continue
        try:
            port = int(cols[8].rsplit(":", 1)[-1])
        except ValueError:
            continue
        if port not in ports:
            ports.append(port)
    return ports


def serves_this_repo(port: int) -> bool:
    try:
        health = api(port, "GET", "/global/health")
        if not (isinstance(health, dict) and health.get("healthy")):
            return False
        proj = api(port, "GET", f"/project/current?directory={REPO_ROOT}")
        return isinstance(proj, dict) and proj.get("worktree") == str(REPO_ROOT)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return False


def discover_port(explicit: int | None) -> int:
    ladder = []
    if explicit:
        ladder.append(explicit)
    if env := os.environ.get("OPENCODE_PORT"):
        ladder.append(int(env))
    ladder.extend(candidate_ports())
    for port in ladder:
        if serves_this_repo(port):
            return port
    sys.exit(
        "error: no opencode server serving this repo found "
        f"(tried: {ladder or 'nothing — is a server running?'})"
    )


def build_prompt(handoff: str, task: str, workspace: str | None) -> str:
    workspace_line = (
        f"Work in the existing workspace at {workspace} — it has been handed "
        "over to you and no other agent is using it."
        if workspace
        else FRESH_LANE_INSTRUCTIONS
    )
    return (
        f"Read {handoff} for context on the work so far, including its "
        f"suggested skills.\n\n{workspace_line}\n\n"
        "Landing policy: feature work and tracked refactors never advance "
        "main without human review — request it per docs/agents/"
        "parallel-work.md (Requesting review). Bugfixes and incidental "
        f"maintenance may auto-land after your own verification.\n\nThen: {task}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--title", required=True, help="session title (house style: <feature-slug>: <focus>)")
    ap.add_argument("--handoff", required=True, help="path to the handoff doc (repo-relative)")
    ap.add_argument("--task", required=True, help="one-line task for the new session")
    ap.add_argument("--workspace", help="existing lane to hand over (default: instruct fresh lane)")
    ap.add_argument("--agent", default="yolo",
                    help="agent/mode for the new session (default: yolo)")
    ap.add_argument("--model", help="provider/model override (default: server default)")
    ap.add_argument("--port", type=int, help="opencode server port (default: probe)")
    ap.add_argument("--dry-run", action="store_true", help="print the calls without making them")
    args = ap.parse_args()

    handoff = Path(args.handoff)
    if not (REPO_ROOT / handoff).exists() and not handoff.exists():
        sys.exit(f"error: handoff doc not found: {args.handoff}")

    create_body: dict = {"title": args.title}
    if args.agent:
        create_body["agent"] = args.agent
    if args.model:
        provider_id, _, model_id = args.model.partition("/")
        if not model_id:
            sys.exit("error: --model must be provider/model")
        create_body["model"] = {"providerID": provider_id, "id": model_id}

    prompt = build_prompt(args.handoff, args.task, args.workspace)
    directory = f"directory={REPO_ROOT}"

    if args.dry_run:
        print(f"would POST /session?{directory}  {json.dumps(create_body)}")
        print(f"would POST /session/<id>/prompt_async?{directory}  agent={args.agent}")
        print(f"--- prompt ---\n{prompt}\n--- end prompt ---")
        print("would POST /tui/show-toast")
        return

    port = discover_port(args.port)
    session = api(port, "POST", f"/session?{directory}", create_body)
    assert isinstance(session, dict)
    session_id = session["id"]

    prompt_body: dict = {"parts": [{"type": "text", "text": prompt}]}
    if args.agent:
        # session-level agent is only metadata; the per-message agent is what
        # actually governs the run, so it must be set here too
        prompt_body["agent"] = args.agent
    api(port, "POST", f"/session/{session_id}/prompt_async?{directory}", prompt_body)

    try:
        api(port, "POST", f"/tui/show-toast?{directory}",
            {"title": "Session spawned", "message": f"{args.title} ({session_id})",
             "variant": "success"})
    except (urllib.error.URLError, OSError):
        pass  # toast is best-effort; a headless server has no TUI

    print(f"spawned {session_id}  title={args.title!r}  port={port}")
    print(f"prompted with task: {args.task}")


if __name__ == "__main__":
    main()

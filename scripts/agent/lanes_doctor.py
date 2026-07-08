#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""The fleet view: one line per lane — ownership, liveness, litter, verdict.

Read-only. Sweeping stays a deliberate act (close protocol,
docs/agents/parallel-work.md). Liveness comes from `GET /session`
`time.updated` — never `/session/status`, which only lists busy sessions.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path

DEFAULT_WS = Path("/Users/murtaza/manadj")
UMBRELLA = DEFAULT_WS  # collapsed root (ADR 0028); .lanes lookups retire in issue 03
LIVE_HORIZON_S = 30 * 60  # owner session updated within this = live


def api(port: int, path: str):
    url = f"http://127.0.0.1:{port}{path}?directory={UMBRELLA}"
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)


def discover_port() -> int | None:
    out = subprocess.run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"],
                         capture_output=True, text=True).stdout
    for line in out.splitlines()[1:]:
        cols = line.split()
        if len(cols) >= 9 and "opencode" in cols[0].lower():
            try:
                port = int(cols[8].rsplit(":", 1)[-1])
                api(port, "/global/health")
                return port
            except Exception:
                continue
    return None


def jj(*args: str) -> str:
    return subprocess.run(["jj", *args], capture_output=True, text=True,
                          cwd=DEFAULT_WS).stdout


def main() -> None:
    port = discover_port()
    sessions: dict[str, float] = {}
    if port:
        for s in api(port, "/session"):
            sessions[s["id"]] = s.get("time", {}).get("updated", 0) / 1000

    # Workspace list — hyphen-safe: names are everything before the first ": ".
    workspaces: dict[str, str] = {}
    for line in jj("workspace", "list").splitlines():
        name, _, rest = line.partition(": ")
        if name:
            workspaces[name] = rest

    registry = {f.stem: f.read_text()
                for f in (UMBRELLA / ".lanes").glob("*.md") if f.stem != "README"}

    now = time.time()
    sweepable: list[str] = []
    for lane in sorted(set(workspaces) | set(registry)):
        if lane == "default":
            continue
        flags: list[str] = []
        owner = ""
        if lane not in workspaces:
            flags.append("registry-without-workspace (delete the file)")
        if lane not in registry:
            flags.append("workspace-without-registry (register or close)")
        else:
            m = re.search(r"owner:\s*(\S+)", registry[lane])
            owner = m.group(1) if m else ""
            if not owner.startswith("ses_"):
                flags.append(f"junk-owner({owner or 'missing'})")

        live = "?"
        if owner.startswith("ses_"):
            upd = sessions.get(owner)
            if upd is None:
                live = "gone"
            else:
                age_m = (now - upd) / 60
                live = f"live({age_m:.0f}m)" if now - upd < LIVE_HORIZON_S else f"idle({age_m/60:.1f}h)"

        unlanded = ""
        if lane in workspaces:
            at = workspaces[lane]
            if "(conflict)" in at.lower() or "conflict" in at:
                flags.append("CONFLICTED-@ (abandon + re-merge)")
            if "(empty)" not in at and at.strip():
                pass  # @ carries content — normal working state
            out = jj("log", "--no-graph",
                     "-r", f"(mutable() & ::{lane}@) ~ empty()", "-T", '"x"')
            unlanded = f"unlanded={len(out)}" if out else ""
            m = re.search(r"\(empty\)\s+\S", at)
            if "(empty)" in at and not at.strip().endswith("(empty)"):
                flags.append("described-empty-@ (hygiene: never describe placeholders)")

        verdict = ""
        if lane in workspaces and live in ("gone",) and not unlanded and "CONFLICTED-@" not in " ".join(flags):
            verdict = "SWEEPABLE"
            sweepable.append(lane)
        print(f"{lane:14} owner={owner or '-':30} {live:10} {unlanded:12} "
              f"{' '.join(flags)} {verdict}")

    if sweepable:
        print(f"\nsweep candidates (close protocol): {', '.join(sweepable)}")
    if not port:
        print("\nwarning: no opencode server found — liveness unknown")


if __name__ == "__main__":
    main()

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""The fleet view: one line per lane — ownership, liveness, litter, verdict.

Read-only. Sweeping stays a deliberate act (close protocol; lanes live in
the embedded sidecar, ADR 0028). Liveness comes from `GET /session`
`time.updated` — never `/session/status`, which only lists busy sessions.
Complements `es lanes` (owner/issue/status) with manadj-specific litter
checks: conflicted @, described empties, unlanded counts, dead owners.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path

DEFAULT_WS = Path("/Users/murtaza/manadj")
SIDECAR = DEFAULT_WS / ".editspace"
LIVE_HORIZON_S = 30 * 60  # owner session updated within this = live


def api(port: int, path: str):
    url = f"http://127.0.0.1:{port}{path}?directory={DEFAULT_WS}"
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)


def discover_port() -> int | None:
    for port in (4096,):
        try:
            api(port, "/global/health")
            return port
        except Exception:
            pass
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


def bare_session(owner: str) -> str:
    return owner.removeprefix("opencode:")


def main() -> None:
    port = discover_port()
    sessions: dict[str, float] = {}
    if port:
        for s in api(port, "/session"):
            sessions[s["id"]] = s.get("time", {}).get("updated", 0) / 1000

    # Workspace list — hyphen-safe: names are everything before the first ": ".
    # Lane workspaces are named manadj--<lane>.
    workspaces: dict[str, str] = {}
    for line in jj("workspace", "list").splitlines():
        name, _, rest = line.partition(": ")
        if name.startswith("manadj--"):
            workspaces[name.removeprefix("manadj--")] = rest

    records = {p.parent.name: p.read_text()
               for p in sorted((SIDECAR / "lanes").glob("*/LANE.md"))}
    lane_dirs = {p.name for p in (SIDECAR / "lanes").glob("*") if p.is_dir()}

    now = time.time()
    sweepable: list[str] = []
    for lane in sorted(set(workspaces) | set(records) | lane_dirs):
        flags: list[str] = []
        owner = ""
        if lane not in workspaces:
            flags.append("record-without-workspace (close: remove lane dir)")
        if lane not in records:
            flags.append("workspace-without-record (LANE.md missing)")
        else:
            m = re.search(r"owner:\s*(\S+)", records[lane])
            owner = m.group(1) if m else ""
            if not bare_session(owner).startswith("ses_") and owner != "human":
                flags.append(f"junk-owner({owner or 'missing'})")

        live = "?"
        ses = bare_session(owner)
        if ses.startswith("ses_"):
            upd = sessions.get(ses)
            if upd is None:
                live = "gone"
            else:
                age_m = (now - upd) / 60
                live = f"live({age_m:.0f}m)" if now - upd < LIVE_HORIZON_S else f"idle({age_m/60:.1f}h)"

        unlanded = ""
        if lane in workspaces:
            at = workspaces[lane]
            if "conflict" in at.lower():
                flags.append("CONFLICTED-@ (abandon + re-merge)")
            out = jj("log", "--no-graph",
                     "-r", f"(mutable() & ::manadj--{lane}@) ~ empty()", "-T", '"x"')
            unlanded = f"unlanded={len(out)}" if out else ""
            if "(empty)" in at and not at.strip().endswith("(no description set)"):
                flags.append("described-empty-@ (hygiene: never describe placeholders)")

        verdict = ""
        if lane in workspaces and live == "gone" and not unlanded \
                and "CONFLICTED-@ (abandon + re-merge)" not in flags:
            verdict = "SWEEPABLE"
            sweepable.append(lane)
        print(f"{lane:32} owner={owner or '-':40} {live:10} {unlanded:12} "
              f"{' '.join(flags)} {verdict}")

    if sweepable:
        print(f"\nsweep candidates (close protocol): {', '.join(sweepable)}")
    if not port:
        print("\nwarning: no opencode server found — liveness unknown")


if __name__ == "__main__":
    main()

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Am-I-stale preflight (run on session resume and before landing).

Checks, from inside an es lane workspace: lane-record ownership,
workspace/record agreement, and whether main moved since your stack's
merge base. Exits non-zero with one line per finding; silent-zero when
clean. Post-migration (ADR 0028): lanes live in the embedded sidecar at
~/manadj/.editspace/lanes/<lane>/repos/murtaza64/manadj, records are
LANE.md, identity is $EDITSPACE_AGENT_ID (editspace-lock plugin).
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_WS = Path("/Users/murtaza/manadj")
SIDECAR = DEFAULT_WS / ".editspace"
LANE_ROOT = Path(__file__).resolve().parents[2]


def lane_name() -> str | None:
    """Lane from a lanes/<lane>/... component of this workspace's path."""
    try:
        rel = LANE_ROOT.resolve().relative_to(SIDECAR.resolve()).parts
    except ValueError:
        return None
    return rel[1] if len(rel) >= 2 and rel[0] == "lanes" else None


def session_id() -> str:
    """Bare session ID from $EDITSPACE_AGENT_ID (opencode:<id>) or legacy env."""
    agent = os.environ.get("EDITSPACE_AGENT_ID", "")
    if agent.startswith("opencode:"):
        return agent.removeprefix("opencode:")
    return os.environ.get("OPENCODE_SESSION_ID", "")


def jj(*args: str) -> str:
    r = subprocess.run(["jj", *args], capture_output=True, text=True, cwd=LANE_ROOT)
    return r.stdout if r.returncode == 0 else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", default=session_id())
    args = ap.parse_args()

    findings: list[str] = []
    lane = lane_name()

    if LANE_ROOT.resolve() == DEFAULT_WS.resolve():
        sys.exit("STALE: you are in the default workspace — read-only for "
                 "agents; open a lane")
    if lane is None:
        sys.exit(f"STALE: {LANE_ROOT} is not an es lane workspace — open a "
                 "lane (es lane create / es agent spawn)")

    record = SIDECAR / "lanes" / lane / "LANE.md"
    if not record.exists():
        findings.append(f"no LANE.md for lane {lane!r} — record missing "
                        f"({record})")
        owner = ""
    else:
        m = re.search(r"owner:\s*(\S+)", record.read_text())
        owner = m.group(1) if m else ""
        owner_ses = owner.removeprefix("opencode:")
        if not owner:
            findings.append("lane record has no owner — stamp one")
        elif args.session and owner_ses != args.session and owner != "human":
            findings.append(f"lane owned by {owner}, you are {args.session} — "
                            "the lane was handed over; open your own")
        elif not args.session:
            findings.append("cannot verify ownership: no $EDITSPACE_AGENT_ID "
                            "(plugin not loaded?) — proceed with care")

    workspaces = jj("workspace", "list")
    ws_name = f"manadj--{lane}"
    if not re.search(rf"^{re.escape(ws_name)}:", workspaces, re.M):
        findings.append(f"workspace {ws_name!r} not in `jj workspace list` — "
                        "it was forgotten while you were away")

    behind = jj("log", "--no-graph", "-r", "main ~ ::@", "-T", '"x"')
    if behind:
        findings.append("main moved since your merge base — merge trunk into "
                        "your lane at the next issue boundary (or re-merge "
                        "before landing)")

    if findings:
        print("\n".join(f"STALE: {f}" for f in findings))
        sys.exit(1)
    print(f"guard: clean (lane {lane}, owner verified)" if owner and args.session
          else f"guard: clean-ish (lane {lane})")


if __name__ == "__main__":
    main()

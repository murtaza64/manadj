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
import subprocess
import sys
from pathlib import Path

try:
    from .project_paths import discover, require_lane, session_id
except ImportError:
    from project_paths import discover, require_lane, session_id

LANE_ROOT = Path(__file__).resolve().parents[2]
PATHS = discover(LANE_ROOT)
DEFAULT_WS, SIDECAR = PATHS.default, PATHS.sidecar


def lane_name() -> str | None:
    """Lane from a lanes/<lane>/... component of this workspace's path."""
    try:
        rel = LANE_ROOT.resolve().relative_to(SIDECAR.resolve()).parts
    except ValueError:
        return None
    return rel[1] if len(rel) >= 2 and rel[0] == "lanes" else None


def jj(*args: str) -> str:
    r = subprocess.run(["jj", *args], capture_output=True, text=True, cwd=LANE_ROOT)
    return r.stdout if r.returncode == 0 else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", default=session_id())
    args = ap.parse_args()

    findings: list[str] = []
    lane = lane_name()
    try:
        require_lane(discover(LANE_ROOT), args.session)
    except ValueError as error:
        sys.exit(f"STALE: {error}")

    behind = jj("log", "--no-graph", "-r", "main ~ ::@", "-T", '"x"')
    if behind:
        findings.append("main moved since your merge base — merge trunk into "
                        "your lane at the next issue boundary (or re-merge "
                        "before landing)")

    if findings:
        print("\n".join(f"STALE: {f}" for f in findings))
        sys.exit(1)
    print(f"guard: clean (lane {lane}, owner verified)")


if __name__ == "__main__":
    main()

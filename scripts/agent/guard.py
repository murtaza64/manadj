#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Am-I-stale preflight (run on session resume and before landing).

Checks, from inside a lane: registry ownership, workspace/registry
agreement, and whether main moved since your stack's merge base. Exits
non-zero with one line per finding; silent-zero when clean.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_WS = Path("/Users/murtaza/manadj/default")
UMBRELLA = DEFAULT_WS.parent
LANE_ROOT = Path(__file__).resolve().parents[2]


def jj(*args: str) -> str:
    r = subprocess.run(["jj", *args], capture_output=True, text=True, cwd=LANE_ROOT)
    return r.stdout if r.returncode == 0 else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", default=os.environ.get("OPENCODE_SESSION_ID"))
    args = ap.parse_args()

    findings: list[str] = []
    lane = LANE_ROOT.name

    if LANE_ROOT == DEFAULT_WS:
        sys.exit("STALE: you are in the default workspace — read-only for "
                 "agents; open a lane")

    lane_file = UMBRELLA / ".lanes" / f"{lane}.md"
    if not lane_file.exists():
        findings.append(f"no registry file for lane {lane!r} — register it "
                        f"({lane_file})")
        owner = ""
    else:
        m = re.search(r"owner:\s*(\S+)", lane_file.read_text())
        owner = m.group(1) if m else ""
        if not owner.startswith("ses_"):
            findings.append(f"registry owner is junk ({owner!r}) — stamp a "
                            "session ID")
        elif args.session and owner != args.session:
            findings.append(f"lane owned by {owner}, you are {args.session} — "
                            "the lane was handed over; open your own")
        elif not args.session:
            findings.append("cannot verify ownership: no $OPENCODE_SESSION_ID "
                            "(plugin not loaded?) — proceed with care")

    workspaces = jj("workspace", "list")
    if not re.search(rf"^{re.escape(lane)}:", workspaces, re.M):
        findings.append(f"workspace {lane!r} not in `jj workspace list` — "
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

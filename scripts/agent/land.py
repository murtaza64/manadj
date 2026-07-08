#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""The mechanical land (parallel-work.md, Trunk-based flow).

Everything after "I decided to land": refuses on rule violations, moves the
bookmark, leaves a fresh placeholder. Verification judgment stays with you.

Usage, from your lane:  uv run scripts/agent/land.py <change> [--hot-reload]
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_WS = Path("/Users/murtaza/manadj")
UMBRELLA = DEFAULT_WS  # collapsed root (ADR 0028); .lanes lookups retire in issue 03
LANE_ROOT = Path(__file__).resolve().parents[2]


def jj(*args: str, cwd: Path = LANE_ROOT) -> str:
    r = subprocess.run(["jj", *args], capture_output=True, text=True, cwd=cwd)
    if r.returncode != 0:
        sys.exit(f"error: jj {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def template(rev: str, tmpl: str, cwd: Path = LANE_ROOT) -> str:
    return jj("log", "--no-graph", "-r", rev, "-T", tmpl, cwd=cwd).strip()


def refuse(reason: str, hint: str) -> None:
    sys.exit(f"REFUSED: {reason}\n  -> {hint}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("change", help="revision to land (your verified head/merge)")
    ap.add_argument("--hot-reload", action="store_true",
                    help="also move default@ to new trunk if it is an idle placeholder")
    ap.add_argument("--session", default=os.environ.get("OPENCODE_SESSION_ID"),
                    help="caller session ID (default: $OPENCODE_SESSION_ID)")
    args = ap.parse_args()

    # Retry invariant: main must be an ancestor of the target.
    if template(f"main & ::{args.change}", "change_id.short()") == "":
        refuse("current main is not an ancestor of the target",
               "trunk moved — stack a fresh merge of new main + your verified "
               "merge, spot-verify the delta, retry (never --allow-backwards)")

    # Conflict check on everything being landed.
    conflicted = template(f"(main..{args.change}) & conflicts()",
                          'change_id.short() ++ " "')
    if conflicted:
        refuse(f"conflicted change(s) in the landing range: {conflicted}",
               "abandon the conflicted merge, resolve in-lane, re-merge")

    # Ownership: the lane's registry owner must be the caller (when knowable).
    lane = LANE_ROOT.name
    lane_file = UMBRELLA / ".lanes" / f"{lane}.md"
    if LANE_ROOT == DEFAULT_WS:
        refuse("landing from the default workspace",
               "land from your lane; the default workspace is read-only for agents")
    if args.session and lane_file.exists():
        m = re.search(r"owner:\s*(\S+)", lane_file.read_text())
        owner = m.group(1) if m else ""
        if owner.startswith("ses_") and owner != args.session:
            refuse(f"lane {lane!r} is owned by {owner}, not {args.session}",
                   "the lane moved on while you were away (guard.py would have "
                   "told you) — open your own lane")
    elif not args.session:
        print("warning: caller session unknown (no $OPENCODE_SESSION_ID) — "
              "ownership check skipped")

    jj("bookmark", "move", "main", "--to", args.change)
    jj("new", "main")  # placeholder on the NEW trunk (bare `jj new` would stack on stale @)
    landed = template("main", 'change_id.short() ++ " " ++ description.first_line()')
    print(f"landed: {landed}")

    if args.hot_reload:
        desc = template("default@", "description", cwd=DEFAULT_WS)
        empty = template("default@", "if(empty, \"y\", \"n\")", cwd=DEFAULT_WS)
        if empty == "y" and desc == "":
            jj("new", "main", cwd=DEFAULT_WS)
            print("default@ hot-reloaded onto new trunk")
        else:
            print("default@ is not an idle placeholder — left alone; "
                  "tell the human the app needs a manual update")


if __name__ == "__main__":
    main()

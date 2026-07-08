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
SIDECAR = DEFAULT_WS / ".editspace"
LANE_ROOT = Path(__file__).resolve().parents[2]


def _lane_and_record() -> tuple[str, Path | None]:
    """(lane name, LANE.md path) for this workspace, from its sidecar path."""
    try:
        rel = LANE_ROOT.resolve().relative_to(SIDECAR.resolve()).parts
    except ValueError:
        return LANE_ROOT.name, None
    if len(rel) >= 2 and rel[0] == "lanes":
        return rel[1], SIDECAR / "lanes" / rel[1] / "LANE.md"
    return LANE_ROOT.name, None


def _session_id() -> str:
    agent = os.environ.get("EDITSPACE_AGENT_ID", "")
    if agent.startswith("opencode:"):
        return agent.removeprefix("opencode:")
    return os.environ.get("OPENCODE_SESSION_ID", "")


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
    ap.add_argument("--session", default=_session_id(),
                    help="caller session ID (default: $EDITSPACE_AGENT_ID)")
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

    # Ownership: the lane record's owner must be the caller (when knowable).
    if LANE_ROOT.resolve() == DEFAULT_WS.resolve():
        refuse("landing from the default workspace",
               "land from your lane; the default workspace is read-only for agents")
    lane, record = _lane_and_record()
    if args.session and record is not None and record.exists():
        m = re.search(r"owner:\s*(\S+)", record.read_text())
        owner = (m.group(1) if m else "").removeprefix("opencode:")
        if owner.startswith("ses_") and owner != args.session:
            refuse(f"lane {lane!r} is owned by {owner}, not {args.session}",
                   "the lane moved on while you were away (guard.py would have "
                   "told you) — open your own lane")
    elif not args.session:
        print("warning: caller session unknown (no $EDITSPACE_AGENT_ID) — "
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

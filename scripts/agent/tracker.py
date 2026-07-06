#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Validating write path for the tracker at /Users/murtaza/manadj/.scratch.

  tracker.py new <feature>/<NN>-<slug>.md  (reads body from stdin)
  tracker.py comment <issue-path> "<text>"           (O_APPEND only)
  tracker.py flip <issue-path> "<status>" [--lane <lane>]

Raw edits remain possible; this is the documented path — it validates,
appends safely, and commits. Concurrency: new files collide never, flips
are own-file writes, comments are O_APPEND (no read-modify-write window);
every write commits to the tracker's jj repo immediately.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

TRACKER = Path("/Users/murtaza/manadj/.scratch")
LABELS_DOC = Path("/Users/murtaza/manadj/default/docs/agents/triage-labels.md")
FALLBACK_LABELS = {"needs-triage", "needs-info", "ready-for-agent",
                   "ready-for-human", "wontfix"}


def labels() -> set[str]:
    if LABELS_DOC.exists():
        found = set(re.findall(r"`([a-z-]+)`", LABELS_DOC.read_text()))
        if found:
            return found
    return FALLBACK_LABELS


def commit(msg: str) -> None:
    lane = os.environ.get("OPENCODE_SESSION_ID", "unattributed")
    subprocess.run(["jj", "-R", str(TRACKER), "commit", "-m", f"{msg} [{lane}]"],
                   capture_output=True, text=True)


def resolve(path: str) -> Path:
    p = TRACKER / path
    if not p.resolve().is_relative_to(TRACKER):
        sys.exit("error: path escapes the tracker")
    return p


def cmd_new(args) -> None:
    p = resolve(args.path)
    if p.exists():
        sys.exit(f"error: {args.path} exists (numbering race? pick the next number)")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(sys.stdin.read())
    commit(f"new {args.path}")
    print(f"created {p}")


def cmd_comment(args) -> None:
    p = resolve(args.path)
    if not p.exists():
        sys.exit(f"error: no such issue {args.path}")
    block = f"\n**{date.today()}**: {args.text}\n"
    if "## Comments" not in p.read_text():
        block = "\n## Comments\n" + block
    fd = os.open(p, os.O_WRONLY | os.O_APPEND)  # atomic append, no RMW window
    try:
        os.write(fd, block.encode())
    finally:
        os.close(fd)
    commit(f"comment {args.path}")
    print("appended")


def cmd_flip(args) -> None:
    p = resolve(args.path)
    if not p.exists():
        sys.exit(f"error: no such issue {args.path}")
    status = args.status.strip()
    base = status.split()[0].rstrip(":")
    if base not in labels() and not status.startswith("done"):
        sys.exit(f"error: unknown status {base!r} (vocabulary: "
                 f"{sorted(labels())} or done…)")
    text, n = re.subn(r"(?m)^Status:.*$", f"Status: {status}", p.read_text(), count=1)
    if not n:
        sys.exit("error: issue has no Status: line")
    p.write_text(text)
    commit(f"flip {args.path} -> {status}")
    print(f"Status: {status}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    new = sub.add_parser("new"); new.add_argument("path"); new.set_defaults(fn=cmd_new)
    com = sub.add_parser("comment"); com.add_argument("path"); com.add_argument("text")
    com.set_defaults(fn=cmd_comment)
    flp = sub.add_parser("flip"); flp.add_argument("path"); flp.add_argument("status")
    flp.set_defaults(fn=cmd_flip)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

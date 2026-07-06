#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Rich situation view: `jj sit` plus merge-base distance per mutable head.

For each head: ahead (changes since merge base with main — stack size),
behind (changes main has that the head lacks — staleness), and the
cumulative diff from merge base (files, +/- — complexity). @/main rows and
plain placeholders are passed through untouched.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def jj(*args: str) -> str:
    r = subprocess.run(["jj", *args], capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(f"error: jj {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def count(revset: str) -> int:
    return len(jj("log", "--no-graph", "-r", revset, "-T", '"x"'))


def main() -> None:
    for line in jj("sit").splitlines():
        rev = line.split(" ", 1)[0]
        if "(empty)" in line:
            print(line)
            continue
        # Pass through @/main/placeholder rows; annotate everything else.
        if "@" in line.split(" ")[1:2] or " main" in f" {line}" and "main*" in line:
            print(line)
            continue
        ahead = count(f"main..{rev}")
        if ahead == 0:
            print(line)
            continue
        behind = count(f"{rev}..main")
        stat = jj("diff", "--from", f"heads(::main & ::{rev})", "--to", rev,
                  "--stat").splitlines()
        summary = stat[-1].strip() if stat else ""
        m = re.match(r"(\d+) files? changed, (\d+) insertions?\(\+\), (\d+) deletions?",
                     summary)
        cum = f"{m.group(1)}f +{m.group(2)}/-{m.group(3)}" if m else summary
        print(f"{line}   <ahead {ahead}, behind {behind}, {cum}>")


if __name__ == "__main__":
    main()

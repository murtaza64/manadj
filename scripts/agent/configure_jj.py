#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Apply repo-scoped jj configuration (idempotent; run once after clone).

`.jj/repo/config.toml` is shared by every workspace of the repo, so one run
benefits all lanes. Applied settings (jj 0.43, keys verified):

- `jj sit` alias: the canonical orientation picture — @, main, and mutable
  heads (minus `tmp:` probes), one line each. Replaces ad-hoc `jj log` zoo.
- `ui.quiet = true`: mutating commands stop narrating ("Working copy now
  at…"); revert with `jj config set --repo ui.quiet false` if missed.
- `hints.resolving-conflicts = false`: drop hint chatter.
"""

import json
import subprocess
import sys

SIT_TEMPLATE = (
    'separate(" ", change_id.shortest(8), bookmarks, working_copies, '
    'if(conflict, "CONFLICT"), '
    'if(empty, "(empty)", "[" ++ diff.files().len() ++ "f +" ++ '
    'diff.stat().total_added() ++ "/-" ++ diff.stat().total_removed() ++ "]"), '
    'description.first_line()) ++ "\n"'
)
SIT_REVSET = "@ | main | (heads(mutable()) ~ description(glob:'tmp:*'))"

# json.dumps yields valid TOML for string arrays, with correct escaping —
# a repr()-built value becomes a TOML *literal* string and breaks "\n".
SETTINGS = [
    ("aliases.sit",
     json.dumps(["log", "--no-graph", "-r", SIT_REVSET, "-T", SIT_TEMPLATE])),
    ("ui.quiet", "true"),
    ("hints.resolving-conflicts", "false"),
]


def main() -> None:
    for key, value in SETTINGS:
        r = subprocess.run(["jj", "config", "set", "--repo", key, value],
                           capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"error setting {key}: {r.stderr.strip()}")
        print(f"set {key}")
    print("done — try `jj sit`")


if __name__ == "__main__":
    main()

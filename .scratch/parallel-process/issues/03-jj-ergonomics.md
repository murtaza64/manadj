# jj ergonomics: sit alias + quiet config

Status: done (2026-07-06, workflow session)

## Parent

ADR 0026; jj-usage analysis 2026-07-06 (62% of agent jj calls are orientation `jj log`s; mutating commands narrate 3-5 lines each).

## What to build

Idempotent `scripts/agent/configure_jj.py` applying repo-scoped jj config (`.jj/repo/config.toml` is shared by all workspaces — run once, benefits every lane):

- **`jj sit` alias**: the canonical orientation picture — `@`, `main`, mutable heads excluding `tmp:`, compact one-line template — replacing the ad-hoc log zoo. Include counts of hygiene litter (described empty heads, conflicted heads) if expressible in a template; otherwise that lives in `lanes_doctor.py` (issue 05).
- **Quieter output**: investigate current jj config keys for suppressing hints and reducing mutating-command narration (`ui.*`/`hints.*` — verify exact names against the installed jj version; do not guess). Apply what exists; document what doesn't.
- Document both in parallel-work.md (one paragraph) and note that fresh clones re-run the script.

## Acceptance criteria

- [ ] `jj sit` works from default and from a lane, output ≤ ~10 lines in today's repo
- [ ] Script is idempotent (second run no-ops)
- [ ] Hint/narration suppression applied where the installed jj supports it, findings documented
- [ ] Docs fast-path land for the doc paragraph; script lands as maintenance

## Blocked by

None - can start immediately

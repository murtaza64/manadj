# Tracker exodus: .scratch to the umbrella, tracker.py validating helper

Status: ready-for-agent

## Parent

ADR 0026 (amend it as part of this issue — this partially reverses the 2026-07-04 tracked-tracker decision; the staleness/churn evidence and the weighed alternatives, including the rejected SQLite tracker with its escalation trigger, are in the workflow session of 2026-07-06).

## What to build

Move the issue tracker out of the repo to a single shared copy at the umbrella root, as its **own pure jj repo** (not git — one VCS vocabulary): `/Users/murtaza/manadj/.scratch/`.

- `jj git init` is wrong; plain `jj init` the directory, move the tree (`git mv` out of the main repo so the deletion lands via trunk), keep all content and paths otherwise identical (`.scratch/<feature>/…` becomes `~/manadj/.scratch/<feature>/…`).
- **`scripts/agent/tracker.py new|comment|flip`** — the validating write path: `flip` checks the status vocabulary (docs/agents/triage-labels.md) and that the caller's lane owns the issue; `comment` appends via O_APPEND only; every subcommand ends with `jj -R ~/manadj/.scratch commit -m "<lane>: <what>"`. Raw edits remain possible; the helper is the documented path.
- Update `docs/agents/issue-tracker.md` (new location, helper usage, concurrency rules: own-file flips, append-only comments, write-then-commit), `spawn-session.md` (handoff paths), and AGENTS.md pointers. Add `~/manadj/tmp/` for durable cross-session harnesses while touching the layout docs.
- Amend ADR 0026 with a short section: what moved, why (per-workspace staleness, trunk churn — measure: count docs-flip landings in recent `main` history), what was lost (code+tracker atomicity), the SQLite escalation trigger.

## Acceptance criteria

- [ ] `.scratch/` gone from the main repo (deletion landed); full history of the move visible in both repos
- [ ] Two concurrent `tracker.py comment` calls on one issue lose nothing
- [ ] `flip` rejects an unknown status and a non-owner flip
- [ ] All skills-facing docs point at the new location; a spawned session finds an issue by path with no guidance
- [ ] ADR 0026 amended

## Blocked by

None - can start immediately (coordinate trivially with 02: both edit issue-tracker.md — additive-append)

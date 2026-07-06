# spawn_session.py v2: identity, handover stamping, sneak spawns, prompt trim

Status: done (2026-07-06, workflow session)

## Parent

ADR 0026; spawn flow gaps found in 2026-07-06 grilling.

## What to build

Four changes to `scripts/agent/spawn_session.py`:

1. **Session ID in the kickoff prompt**: the script knows the created session's ID — tell the child ("You are session `ses_…`") so it can stamp registry `owner:` fields correctly. (Superseded at runtime by issue 07's env var, but the prompt line stays as fallback and for humans reading transcripts.)
2. **`--workspace` handover stamps ownership**: update the lane's `.lanes/<lane>.md` `owner:` to the new session's ID at spawn time — ownership transfers atomically with the handoff.
3. **`--handoff` becomes optional** (sneak-fix delegation): without it, `--task` must be self-contained and the prompt says so; with `--sneak`, the prompt prescribes an ephemeral `sneak-<slug>` lane, auto-land rules, and close-after-land.
4. **Trim the landing-policy paragraph** from the prompt — triple-redundant with AGENTS.md (in every session) and parallel-work.md. Keep only: handoff pointer (if any), workspace line, session identity, task.

## Acceptance criteria

- [ ] Dry-run shows: session ID line, no landing-policy paragraph
- [ ] `--workspace` run updates the registry owner (verify file content)
- [ ] `--task`-only spawn works; `--sneak` prompt includes lane naming + close protocol pointer
- [ ] docs/agents/spawn-session.md updated to match

## Blocked by

None - can start immediately

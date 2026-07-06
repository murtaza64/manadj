# Session-identity plugin

Status: ready-for-agent

## Parent

ADR 0026; the junk-`owner:` field problem (sessions don't know who they are).

## What to build

A minimal opencode plugin (`.opencode/` in the repo) that exposes each session's own ID to its tool executions — an env var (e.g. `OPENCODE_SESSION_ID`) visible to bash tool calls. No policy logic, no interception, no blocking: identity only.

Consumers (already written to degrade gracefully without it): `land.py` and `guard.py` ownership checks (issues 04/05), registry stamping by any session (`owner:` fields become mechanical), `lane_app.py`/`tracker.py` attribution.

Consult the opencode plugin API docs (https://opencode.ai/docs) for the correct hook; prefer the smallest surface that sets an env var for shell executions. Verify against the running server version.

Explicitly out of scope (escalation trigger recorded in issue 02's parallel-work.md text): the write-interceptor/enforcement plugin.

## Acceptance criteria

- [ ] In a fresh session, `echo $OPENCODE_SESSION_ID` prints that session's ID
- [ ] Works in spawned (yolo) and interactive sessions; absent gracefully in environments without the plugin
- [ ] land.py/guard.py pick it up with no flags (verify with a fabricated ownership mismatch)
- [ ] One-paragraph doc note in parallel-work.md registry section

## Blocked by

None - can start immediately

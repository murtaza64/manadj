This projet is a pre-pre-pre-alpha in active development. It has no users other than the developer. As such, BACKWARD COMPATIBILITY IS NOT A CONCERN.

this project is managed by uv.
to add requirements, use `uv add`.
to run scripts or modules, use `uv run path/to/script.py` or `uv run -m path.to.module`

this project does NOT prefer pastel colors as per my global theme, instead preferring bright, fully saturated colors

## Agent skills

### Issue tracker

Issues and PRDs are markdown files in the tracker repo at `/Users/murtaza/manadj/.scratch/<feature>/` — outside the main repo, shared live across all lanes, its own jj repo. Write via `uv run scripts/agent/tracker.py new|comment|flip` (validating path). See `docs/agents/issue-tracker.md`.

### Version control

This repo uses jj. One jj change per issue; change description = `<feature-slug>: <issue-file-stem>`, e.g. `soundcloud-acquisition: 01-investigate-likes-scanning`.

### Parallel work (multiple agents)

Trunk-based: `main` is trunk; landed history is immutable. Landing policy: bugfixes and incidental maintenance auto-land after agent-owned verification (the test suite is a suggestion; single alembic head is the one hard invariant); feature work and tracked refactors require human review first — run the lane app (`uv run scripts/agent/lane_app.py start`) and request review per `docs/agents/parallel-work.md`. One lane = one workspace = one agent. Never rewrite a change another workspace's `@` sits on or descends from; never touch another lane's workspace. Real DB lives only in the default workspace — lanes APFS-clone it (`cp -c`), never symlink; migrations touch the real DB only after landing. Full rules, lane registry (`.lanes/`), hotspot protocol, probes: `docs/agents/parallel-work.md` (ADR 0012).

### Spawning sessions

Hand work to a fresh opencode session via the server API instead of a pasted handoff: write the handoff to `.scratch/<feature>/handoffs/`, then run `uv run scripts/agent/spawn_session.py`. See `docs/agents/spawn-session.md`.

### Process language

Use these terms bare; never restate their mechanics (a handoff/issue that re-explains AGENTS.md or `docs/agents/` content is a bug). Full mechanics: `docs/agents/parallel-work.md`.

- **Park**: complete review-gated work without landing — flip to `ready-for-human` with a Walkthrough, start the lane app, toast, keep building on top.
- **Walkthrough**: the verification guide for parked work — URL/desktop command, the 3-5 clicks, what correct looks like. Printed in-session; durable copy in the issue.
- **Handover**: transfer of lane ownership to another session; registry `owner:` updates atomically with it.
- **Track**: an ordered subset of one feature's issues worked by one lane, parallel to sibling tracks.
- **Quiescent**: a lane with no live owner session and nothing unlanded — safe to hand over or close.
- **Orchestrator**: a session that coordinates (spawns tracks, relays Walkthroughs, runs the doctor, sweeps) and never owns a feature lane or lands feature code.
- **Sneak fix**: an auto-land-eligible fix with no tracker artifact; the change description is the whole record; ephemeral `sneak-<slug>` lane.
- Bare-use (defined in parallel-work.md): Lane, Land, fast-path, additive-append, Probe, Sandbox DB, Claim, review-gated, auto-land, idle placeholder.

Rules: run `guard.py` on session resume and before landing (stale-ownership check). Never dump full `--git` diffs into a session — `--stat` first, then targeted reads.

### Database migrations

Alembic (see `docs/adr/0005-alembic-migrations.md`). Generate revisions with `uv run alembic revision [--autogenerate] --rev-id <NNNN>_<jj-short-id> -m "<slug>"` — sequential number, suffixed with the jj change short ID of the change the migration belongs to. Parallel duplicates of a number are fine: alembic flags multiple heads; re-parent one. Startup auto-migrates (`upgrade head`). Never use `Base.metadata.create_all` for the app DB.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

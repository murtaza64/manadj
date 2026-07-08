This projet is a pre-pre-pre-alpha in active development. It has no users other than the developer. As such, BACKWARD COMPATIBILITY IS NOT A CONCERN.

this project is managed by uv.
to add requirements, use `uv add`.
to run scripts or modules, use `uv run path/to/script.py` or `uv run -m path.to.module`

this project does NOT prefer pastel colors as per my global theme, instead preferring bright, fully saturated colors

## Agent skills

### Editspace

manadj is a single-repo editspace (ADR 0028): the repo at `~/manadj` is the
default workspace; the embedded sidecar `~/manadj/.editspace/` (own jj repo,
gitignored) holds the issue tracker, handoffs, and lanes. Canonical mechanics:
`~/dotfiles/docs/editspace-lanes.md` — this file and `docs/agents/` state only
manadj's divergences and domain layer. Coordinate via `es` (`es issue`,
`es lane create`, `es agent spawn/resume`, `es wait`, `es lanes`).

### Issue tracker

Issues live in the sidecar: `.editspace/issues/<feature-slug>/<NN>-<slug>.md`.
Claim atomically via `es issue claim`; comments via `es issue comment`; status
flips by direct edit of your own issues' `Status:` line, then
`jj -R ~/manadj/.editspace commit`. PRDs/ADRs/CONTEXT stay in the repo
(`docs/prds/`, `docs/adr/`, `CONTEXT.md`). See `docs/agents/issue-tracker.md`.

### Version control

This repo uses jj. One jj change per issue; change description =
`<feature-slug>: <issue-file-stem>`, e.g.
`soundcloud-acquisition: 01-investigate-likes-scanning`.

### Parallel work (multiple agents)

Trunk-based on **local** `main` (a deliberate divergence — push is backup, not
gate). Landing policy: bugfixes and incidental maintenance auto-land after
agent-owned verification (the test suite is a suggestion; single alembic head
is the one hard invariant); feature work and tracked refactors park for human
review — lane app + Walkthrough. Landing is lane-owned via
`uv run scripts/agent/land.py` (merge protocol, refusals, `--hot-reload`).
The real DB (`~/manadj/data`) is unreachable to lane agents (permission walls
+ the data-write-guard plugin) — `lane_app.py` clones your sandbox internally;
migrations touch the real DB only after landing. Full rules and divergence
list: `docs/agents/parallel-work.md` (ADRs 0012, 0026, 0028).

### Spawning sessions

`es agent spawn --agent lane [--handoff <path>] --title "<slug>: <focus>"
--task "..."` — fresh lane, owner stamped, opus by default. Revive with
`es agent resume`. Handoffs live in the sidecar (`.editspace/handoffs/`).

### Process language

Use these terms bare; never restate their mechanics (a handoff/issue that
re-explains AGENTS.md or `docs/agents/` content is a bug). Generic terms
(Lane, Land, Park, Walkthrough, Handover, Quiescent, Orchestrator, Probe,
Claim, frontier, parked vs landed): `~/dotfiles/docs/editspace-lanes.md` and
dotfiles CONTEXT.md. manadj-specific terms (Sandbox DB, docs fast-path,
auto-land, sneak fix, idle placeholder, harvest): `docs/agents/parallel-work.md`.

Rules: run `uv run scripts/agent/guard.py` on session resume and before
landing (stale-ownership preflight). Never dump full `--git` diffs into a
session — `--stat` first, then targeted reads. Your shell carries
`$EDITSPACE_AGENT_ID` (`opencode:<session-id>`, injected by the global
editspace-lock plugin); `guard.py`/`land.py` read it for ownership checks.
Destructive tests target decoy files only — never a real asset (ADR 0028
amendment).

### Database migrations

Alembic (see `docs/adr/0005-alembic-migrations.md`). Generate revisions with `uv run alembic revision [--autogenerate] --rev-id <NNNN>_<jj-short-id> -m "<slug>"` — sequential number, suffixed with the jj change short ID of the change the migration belongs to. Parallel duplicates of a number are fine: alembic flags multiple heads; re-parent one. Startup auto-migrates (`upgrade head`) and backs up the real DB first (`scripts/agent/db_backup.py`). Never use `Base.metadata.create_all` for the app DB.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

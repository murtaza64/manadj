# Parallel work: manadj's divergences and domain layer

Canonical lane/editspace mechanics live in `~/dotfiles/docs/editspace-lanes.md`
(prime rules, lanes, claims, hotspot discipline, ownership/handover, probes,
orchestration, reporting vocabulary). This doc states only what manadj does
**differently** and what is manadj-specific. History: ADRs 0012 (trunk), 0026
(review gate, merge landing), 0028 (editspace migration, incident amendments).

## Deliberate divergences from canon (do not "fix")

1. **Trunk is local `main`** (`trunk() = present(main)`, repo-pinned).
   Immutability applies the moment `main` moves; pushing to origin is backup
   hygiene, not part of the gate. After advancing `main` from your own head,
   immediately `jj new`.
2. **Landing is lane-owned and merge-based** via
   `uv run scripts/agent/land.py <change> [--hot-reload]` — no separate
   lander. The landing merge pins the exact `main` verified against; retries
   when `main` moves are new merges, never rewrites; `main` only ever moves to
   a descendant of itself. Rebase is an intra-lane cleanup tool only; catch up
   with trunk by merging it into your lane at issue boundaries.
3. **Auto-land policy** (canon parks everything): bugfixes, incidental
   maintenance, and the docs fast-path auto-land after agent-owned
   verification; feature work and tracked refactors park (`ready-for-human` +
   Walkthrough + running lane app) and land only on human approval. Unsure →
   park. **Sneak fix**: an auto-land-eligible fix with no tracker artifact —
   description `<area>: <symptom> → <fix> (sneak)` is the whole record.
4. **Docs fast-path**: a change touching only docs files (`docs/`,
   `CONTEXT.md`, `AGENTS.md`) may land immediately with a reduced gate
   (sanity-read the diff). Any lane may use it for cross-lane-relevant updates.

## Verification (the landing agent owns it)

The issue's Testing Decisions are the spec. The standard suite is a
suggestion: `uv run -m pytest`; `npx vitest run` + `npm run build` in
`frontend/`; `ruff check` on touched files. One hard invariant, always:
`uv run alembic heads` → exactly one head.

## The lane agent and the write boundary

Sessions are spawned with `--agent lane` (`.opencode/agent/lane.md`): cwd =
your lane's repo workspace; everything outside is `external_directory`-denied
except the sidecar and `~/dotfiles/docs`. Enforcement facts (ADR 0028
amendment — hard-won, do not re-derive by incident): opencode edit-permission
denies are inert; the deny boundary is the resolved project root (the sidecar,
so sibling lanes are NOT permission-isolated — prime rule 2 and lock leases
cover that); the real DB is protected by the `data-write-guard` plugin
(blocks file-tool writes under `~/manadj/data` for every agent) plus automatic
backups. Sanctioned ops on trunk/default-workspace flow only through
`land.py`. Destructive tests target decoys only.

## Database (Sandbox DB)

- The real DB exists only in the default workspace (`~/manadj/data/library.db`).
- `lane_app.py start` clones your sandbox (APFS `cp -c`) internally and takes
  a real-DB backup point first. Staleness is a feature; re-clone for fresher
  data (delete your `data/library.db`, restart the lane app).
- Migrations run against the real DB only after landing (startup
  auto-migrate, which also backs up first via `db_backup.py`). Pre-trunk,
  migrations execute only on sandbox clones.
- Backups: `data/backups/`, automatic (backend startup, lane-app clone,
  closure harvest), retention 48h-all/daily-14d/weekly. Restore runbook:
  `scripts/agent/db_backup.py` header.

## Lane app (review venue)

`uv run scripts/agent/lane_app.py start|status|stop` from your lane: ensures
sandbox DB + deps, self-assigns a free port offset on first start (recorded as
a `ports:` line in your `LANE.md`), daemonizes backend+vite. Refuses in the
default workspace. Desktop shell attaches from anywhere:
`npm --prefix ~/manadj/desktop start -- --port <vite port>`.

## Closure (extends canon's lane teardown)

Before removing a lane dir: `lane_app.py stop`, then **harvest** the lane's DB
clone if newer than the newest backup
(`uv run scripts/agent/db_backup.py --harvest <lane>/data/library.db`), then
`jj workspace forget manadj--<lane>` and remove `lanes/<lane>/`.
`uv run scripts/agent/lanes_doctor.py` reports litter (described empties,
conflicted heads, dead-owner lanes, record/workspace mismatches).

## Probes and prototypes

Probes materialize in the requesting lane against its DB clone (canon rule) —
never in the default workspace; realistic-data probes against the real DB are
human acts. Prototype changes never land: `tmp:`/throwaway descriptions,
absorb as fresh implementation changes, abandon the prototype.

## The default workspace

The human's: real DB, real app (ports 8000/5173), their working copy.
Read-only for agents — all agent work happens in lanes (docs lanes are cheap).
Agent-initiated `@` moves are limited to `land.py --hot-reload`'s sanctioned
post-landing maneuver, gated on `@` being an idle placeholder (empty,
undescribed — never describe placeholders). A non-idle `@` is the human's:
back off and report.

## Hotspots (manadj additions to canon's hotspot discipline)

- **Alembic**: duplicate revision numbers in parallel lanes are fine; the lane
  landing second re-parents; the single-head invariant keeps multi-head off
  trunk.
- **Structural code** (`App.tsx`, `api/client.ts`, `backend/main.py` router
  list, `models.py`): additive-append; reshaping is claimed and lands alone.

## jj ergonomics

`uv run scripts/agent/configure_jj.py` once per clone (idempotent): `jj sit` =
the orientation picture; `uv run scripts/agent/sit.py` adds merge-base
distance per head. Identity: `$EDITSPACE_AGENT_ID` (global editspace-lock
plugin) — `guard.py` (run on resume + before landing) and `land.py` read it.

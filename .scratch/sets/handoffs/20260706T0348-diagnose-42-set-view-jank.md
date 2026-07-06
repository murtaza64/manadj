# Handoff: set-view O(n) interaction jank — diagnosis in flight

Written 2026-07-06 by the conductor-lane session (mid-review, work paused by
the human). You are a fresh diagnosis/bugfix session for **issue 42**.

## Task

`.scratch/sets/issues/42-set-view-on-interaction-jank.md` — the issue body IS
the current state: symptom, the already-built red loop, ranked hypotheses,
and the just-landed possibly-overlapping fix (`mkkxptqx`). Do not rebuild
what exists; pick up at diagnosing-bugs Phase 3/4 (attribute), after
re-running the loop against current main (Phase 2 re-check — `mkkxptqx`
landed after the red measurements).

## Read first

1. `.scratch/sets/issues/42-set-view-on-interaction-jank.md` — everything
   measured so far + the harness paths and gotchas.
2. `docs/agents/parallel-work.md` — lanes, landing, hotspots. Binding.
3. `jj log` around `mkkxptqx` — the frame-budgeted ladder-draw fix that may
   have changed the baseline.

## Workspace

Open a **fresh lane** (suggest `setperf`):

- `jj workspace add --name setperf -r main ../manadj-setperf` (from
  /Users/murtaza/manadj)
- `.lanes/setperf.md` per the registry format; owner = your session id.
  Check `.lanes/` for a FREE port offset before picking (collisions have
  bitten twice; +100/+140/+170 etc. are taken — read the files).
- Sandbox DB: `cp -c /Users/murtaza/manadj/data/library.db data/library.db`
  from your lane dir (the big set "FUCKBOY SUMMER VOL 1" and "post-forest"
  are in it — the repro data).
- `npm install` in `frontend/`, `uv run scripts/agent/lane_app.py start`,
  then point the harness at YOUR vite port:
  `node /var/folders/30/r992kzw55nggl3vt8yqkt5780000gn/T/opencode/perfloop/interact.js http://localhost:<your-vite-port>`

## Parallel lane fences

- **conductor lane (this one) is LIVE and parked for review**: owns
  `sets/Conductor.ts`, conductor stores, `spaceTransport`/`SetSpaceTransport`,
  the editor playhead overlay; its app runs on 5343 — do not touch its
  workspace or measure against its app for attribution. If your profile
  (run against the conductor stack out of curiosity, or post-landing)
  implicates `SetSpaceTransport`, comment on issue 34 instead of fixing it
  yourself — the conductor lane amends its own parked stack.
- **setui / setsugg** history owns the row/ladder files you will likely
  touch (`SetDetailPane.tsx` rows, `OverviewLadder.tsx`, `ladderWaveStyle`,
  `rowColumns`/`rowMarks`) — check `.lanes/*.md` status lines before editing;
  if a lane is idle/landed you are clear. `mkkxptqx` (whoever landed it) may
  still be iterating — check its lane's registry file and leave a tracker
  comment on 42 saying what you're taking.
- Tracker is append-only across lanes; status-line edits only on 42.

## Landing policy

Bugfix: auto-land after your own verification. The verification spec =
`interact.js` red→green (big-set clicks within noise of small-set clicks),
plus the standard suite as a suggestion (`npx vitest run`,
`npm --prefix frontend run build`); HARD invariant `uv run alembic heads` →
one head (no migrations expected). Post-landing: hot-reload check per
parallel-work.md, and comment the root cause on issue 42 (the hypothesis
that survived — Phase 6 of the skill).

## Suggested skills

- `diagnosing-bugs` — you are mid-loop at Phase 2→3; the skill's phase
  discipline is the map. Do NOT skip re-reproduction against current main.

## Out of scope

- Issues 39 (ladder GL rendering — deferred by design), 34/38 (parked,
  conductor lane), any Conductor semantics.
- Ladder feature changes beyond the perf fix.

## No secrets

Nothing sensitive here or in the referenced files.

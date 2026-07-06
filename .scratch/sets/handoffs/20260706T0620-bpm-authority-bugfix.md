# Handoff: sets — planner tempo must use the beatgrid (bpm-authority bugfix)

## Bug (diagnosed 2026-07-05, live incident — Kambi → Raskal)

The Set plan computes tempo-match rates from `tracks.bpm`, but the Transition editor uses the beatgrid's dominant BPM first (`beatgrid.tempo_changes[0].bpm ?? track.bpm`). Where the two diverge, the editor is aligned and the Set is not. Observed: Raskal (track 512) has `bpm = 8700` centiBPM (87.0, half-time) while its grid says 174.0 → editor rate −1.1%, planner rate ≈ +98% → Raskal's ladder mapping and Conductor playback are ~2× misaligned. ADR 0016: when a Beatgrid exists it is THE tempo authority; the bpm column is only its projection (and is provably stale on 12 unarchived tracks right now).

## Task (bugfix — auto-land after verification)

Make every Set-plan tempo input use the editor's authority chain: **beatgrid dominant BPM if a grid exists, else `track.bpm`**.

- The track-facts assembly feeding the planner (`useSetPlan`'s `bpm:` field) is the main site; find an efficient source for per-track grid BPM (bulk, not N+1 — check what the browse/library already loads; a `bpm_effective` on the tracks list API is acceptable if the backend computes the projection cheaply, but prefer client-side reuse of already-fetched grid data if it exists).
- Sweep the other plan-adjacent BPM consumers for the same mistake and fix any that affect audio or geometry: take-vectorization facts passed from the planner (`bpmOut/bpmIn`), Fixed-tempo `setTempoBpm` default (first track's BPM), pickup mapping if it re-derives rates. Follow-mode's BPM *filter* is out of scope (heuristic, not geometry).
- Regression test at the planner seam: a pair whose track.bpm is half its grid BPM must plan with the grid rate (mirror the Kambi/Raskal numbers: 172 grid vs 174 grid, field 87).
- Verification: reload the Set — Kambi→Raskal ("drop 2 double", start 68.1, 379 beats, B entry 20.1) must render in the ladder exactly as the editor shows it, and audibly play matched. Print verification in your output.

## Workspace — handed over (idle lane setpins)

- `/Users/murtaza/manadj-setpins`; `jj new main` first; registry `.lanes/setpins.md`; ports +120; re-clone sandbox DB (it contains the diverged rows — good test data).
- One jj change: `sets: planner-bpm-authority (bugfix)`.

## PARALLEL LANE STATE

- setlist is running 25 (pickup predicate / editor stand-down) — if pickup's rate math needs your fix, keep your edit surgical and expect whoever lands second to rebase.
- setui is running the rows bundle — `useSetPlan` is shared with their preview work; your change to its input assembly is small; coordinate via lands-second-rebases.

## Out of scope

- Repairing the 12 diverged tracks' data (separate surfacing ticket — some grids are the wrong side; needs human eyes).
- Any grid analysis or projection-maintenance change.

## Gate

pytest, frontend build, vitest (planner suite), single alembic head, lint on touched files. `code-review` before landing.

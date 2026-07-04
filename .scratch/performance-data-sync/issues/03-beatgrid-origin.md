# Beatgrid origin

Status: ready-for-agent

## Parent

`.scratch/performance-data-sync/PRD.md`

## What to build

Record where each Beatgrid came from so "is this saved info?" is a stored fact instead of a lossy structural guess. New origin value on the Beatgrid model — `generated` | `edited` | `imported`:

- Lazy auto-creation from track BPM writes `generated` (a *placeholder grid*, per the glossary — not saved info)
- Any grid edit (set downbeat, nudge, BPM-driven regeneration from a user action) flips it to `edited`
- `imported` is written by the import slices (nothing writes it yet in this slice)

Alembic migration; existing rows backfilled once at migration time using the old structural heuristic (single tempo change at t=0 matching track BPM → `generated`, else `edited`). Origin is exposed wherever grid data is served so later slices and the sync view can gate on it.

## Acceptance criteria

- [ ] Migration adds the origin column with the one-time heuristic backfill (rev-id per AGENTS.md convention)
- [ ] First GET of a track without a grid creates a `generated` placeholder
- [ ] Set-downbeat and nudge flip origin to `edited`; regeneration after a grid DELETE yields `generated` again
- [ ] Origin is visible in the grid API response
- [ ] Router-seam tests cover the transitions (TestClient + in-memory DB, per prior art)
- [ ] Typecheck and full test suite pass

## Blocked by

None - can start immediately

## Comments

**2026-07-04 — Done** (jj change `otwxtmsn`, workspace perfdata). `beatgrids.origin` added (`generated`/`edited`/`imported`), migration `0008_otwxtmsn` with one-time heuristic backfill; lazy GET creates `generated`, set-downbeat/nudge flip to `edited` (via `update_beatgrid_tempo_changes(origin=...)`, default "edited"), DELETE+GET regenerates as `generated`. Origin exposed in BeatgridResponse. Router tests + a 0007→head migration-backfill test in `tests/test_beatgrid_origin.py` (minimal-app fixture — backend.main pulls the analysis stack). Migration rehearsed on a copy of the real library: 920 edited / 40 generated.

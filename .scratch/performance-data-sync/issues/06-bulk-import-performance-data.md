# Bulk import performance data from Engine

Status: ready-for-human (implemented, change xxsvrstl; landed in merge vspmwkvl — verify bulk flow by eye)

## Parent

`.scratch/performance-data-sync/PRD.md`

## What to build

One gesture that pulls a track's — or a whole group's — performance data home from Engine: Hot Cues, Beatgrid, Main cue, and key together. Available at track scope and at group scope in the sync view, reusing the existing scope-confirm pending-action pattern (library-wide = the group action on an unfiltered view; no separate button).

Two tiers, per the PRD's unconditional no-silent-overwrite rule:

- **Automatic (fill-empty)**: hot cues where manadj has none; Engine grid where manadj's is absent or a `generated` placeholder; main cue where manadj's is unset (overridden-flag Engine cues only); key where manadj's is empty
- **Confirm**: every overwrite of saved info — listed per track × field, individually applicable, hot-cue rows offering fill-slots vs replace-all — including diverged keys, no per-field exceptions

Key rides the bundle but keeps its existing scalar divergence semantics everywhere else. With this landed, the standalone backfill script is retired.

## Acceptance criteria

- [ ] Bulk action available per track and per group in the sync view
- [ ] Automatic tier applies all fill-empty cases in one pass with no confirmation
- [ ] Confirm tier lists overwrites per track × field; user can apply selectively or all; nothing saved is overwritten without it
- [ ] Diverged key overwrites appear in the confirm list like any other field
- [ ] Re-running the bulk action after a full import reports everything in sync and does nothing
- [ ] Router-seam tests cover tier assignment, selective application, key bundling, and idempotence
- [ ] `scripts/import/engine_performance_data.py` deleted
- [ ] Typecheck and full test suite pass

## Blocked by

- 04-hotcue-divergence-and-import
- 05-beatgrid-maincue-divergence-and-import

## Comments

**2026-07-04 — Done** (jj change `xxsvrstl`, workspace perfdata). `POST /api/sync/performance/bulk-import` (`backend/sync_performance/bulk.py`): automatic fill-empty tier + pending overwrite items, applied only when listed in `overwrites` (hotcues carry a fill-empty/replace-all mode). Key rides the bundle via `EnginePerformanceFields.key` (Engine Track row) while staying an ordinary Track attribute. Comparison helpers extracted to `backend/sync_status/compare.py` (shared by aggregator + bulk). UI: group action on the div-perf inbox, whole-library button in maintenance, per-row "this track" action, and a `BulkConfirmPanel` (checkboxes, per-item hotcue mode select, variable-grid ⚠). Script `scripts/import/engine_performance_data.py` deleted. 11 router-seam tests. Sandbox real-library rehearsal: 990/992 matched in 3.2s; auto tier filled 60 grids / 228 main cues / 471 keys; 23 overwrites pending; re-run idempotent (0 applied, pending stable).

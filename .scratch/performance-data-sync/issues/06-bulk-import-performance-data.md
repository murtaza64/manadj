# Bulk import performance data from Engine

Status: ready-for-agent

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

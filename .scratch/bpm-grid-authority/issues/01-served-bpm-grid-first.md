# 01 — Serve one grid-first BPM; drop `bpm_effective`; backfill the column

Status: ready-for-agent
Type: task

ADR 0027 §2. Pre-alpha: no backward compatibility.

## Change

- `schemas.Track.bpm` serves what `models.Track.bpm_effective` computes
  today (grid-first dominant tempo, column fallback), with two fixes
  folded in:
  - authority = grid with `origin != "generated"` only (ADR 0027 §3;
    coordinate with issue 03 — if 03 lands first this is already done);
  - dominant-tempo duration = waveform duration, `duration_secs`
    fallback (today `models.py:52-67` uses only `duration_secs`;
    NULL duration on a variable grid silently yields the first
    segment's tempo — same bug as `sync_performance/apply.py:102-104`).
- Delete the separate `bpm_effective` response field (`schemas.py:86-87`)
  and the frontend's `bpm_effective ?? bpm` fallbacks (`sets/planner.ts:62`,
  grep for the rest). Frontend `Track.bpm` remains float BPM.
- Centibpm column becomes internal-only: still feeds SQL sort/filter
  (`crud.py:104-108`) and exports, kept honest by writers. One-time
  backfill script (`scripts/` — data, not alembic): for every track with
  a real grid, column := dominant tempo. Report rows changed.
- Exports read the projection: Rekordbox XML (`rekordbox/xml.py:28`),
  ID3 write-back (`write_metadata_to_files`), sync-status BPM cell
  (`sync_status/aggregator.py:104` — the ADR 0016 line-61 follow-up).

## Testing decisions

- Router-level: gridded track serves grid tempo as `bpm` even when the
  column diverges; gridless serves column; variable grid serves dominant
  (existing `tests/test_bpm_effective.py` cases port over, field renamed).
- Backfill: diverged fixture reconciles; gridless untouched.
- Frontend: `npx vitest run` + build (mechanical fallout only).

## Notes

- `useDeckBpmSync` (cue-quantize-bpm 02) then feeds grid-first tempo
  into deck jump math automatically; issue 05 removes that dependency
  entirely.
- **Backfill ordering hazard**: ~12 known rows diverge because the GRID
  is wrong (analysis-curation 02, e.g. Say Nothing: field 172 correct,
  grid 114.9 wrong). The backfill would overwrite those correct fields
  with wrong-grid tempos. Hand-verify analysis-curation 02's repro-query
  rows (fix or delete the wrong grids) BEFORE running the backfill; the
  serving change itself can land first (it changes display, destroys
  nothing).

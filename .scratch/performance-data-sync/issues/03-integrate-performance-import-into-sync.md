# 03 — Integrate Engine performance-data import into the Sync system

Status: wontfix (superseded — the perfdata-lane grill re-scoped this feature into its new PRD + issues 04–07 on that lane)

## Parent

`.scratch/performance-data-sync/issues/01-sync-hotcues-beatgrids.md` (narrows its External-Import half to a concrete slice)

## What to build

Promote the one-shot backfill script (`scripts/import/engine_performance_data.py`) into a proper, repeatable **External Import** operation for performance data (Beatgrids + Hot Cues, Engine → manadj), surfaced through the sync system like the other sync operations.

- **Backend operation**: reuse the script's parsing (PerformanceData BLOBs) and import policy verbatim — constant grids only, skip grids drifting >0.05 from Engine's own analysis, never replace a non-auto-generated manadj grid, never overwrite existing manadj Hot Cues. Match tracks via the existing sync Match machinery (TrackIndex), not the script's ad-hoc filename matching.
- **API + UI**: an endpoint reporting what would change (per-track: grid to import/replace, hot cues to import, skip reasons) and an apply endpoint; a surface in the sync view alongside the existing operations — dry-run list first, apply second, mirroring the established sync UX.
- **Repeatability**: running it twice is a no-op; newly-gridded Engine tracks show up on the next run. This replaces the "run the script again someday" workflow.
- **BPM alignment on import** (ties to issue 02): when importing a constant grid for a track whose BPM is missing or disagrees (>0.05, excluding half/double-time), update `track.bpm` from the grid tempo in the same operation — the one-time backfill did this retroactively; the sync path must keep it true going forward.

## Out of scope

- Export direction (manadj → Engine PerformanceData) and Rekordbox either way — stays in issue 01's broad scope
- Variable (multi-tempo-change) grids — keep skipping with a counted reason
- Waveforms (never synced)

## Acceptance criteria

- [ ] Dry-run endpoint lists per-track actions + skip reasons; apply performs exactly what the dry run showed
- [ ] Policy parity with the script (auto-grid replacement, curated preservation, drift/variable skips, no hot cue overwrites) — covered by module-interface tests per ADR 0002 (schema-real Engine SQLite fixtures per ADR 0004, no committed binary fixtures)
- [ ] Track matching goes through the shared sync Match machinery
- [ ] Second consecutive run reports nothing to do
- [ ] `track.bpm` updated from imported grid tempo per issue-02 policy
- [ ] Sync view shows the operation with the standard dry-run → apply flow
- [ ] Typecheck, lint, vitest, pytest green

## Blocked by

None - can start immediately (the standalone script remains the reference implementation until this lands, then gets deleted).

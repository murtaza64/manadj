# 06 — demolitions, Main cue move, full-library regeneration

Status: resolved (wfproto lane, 2026-07-04 — post-landing steps below)

## Parent

`.scratch/waveform-overhaul/PRD.md`

## What to build

The old waveform system is removed and the library regenerated:

- Drop the three JSON peak columns and `png_path` from the waveforms table (migration); delete the PNG generation code, the `/waveforms` static mount, and the PNG files on disk; remove the JSON waveform endpoint/schemas and the legacy `png_url` frontend type field.
- Move `cue_point_time` (Main cue) off the waveform row to the Track (migration + router/schema updates + frontend API client) — the Main cue is performance data, not an Analysis artifact. Preserve existing values in the migration; sync/divergence code that reads Main cue follows the new location.
- Full-library re-analysis: every Track gets v2 Waveform data (bulk path from issue 02); the invalidate script is updated for the new format.
- Remove `librosa`/`scipy`-only-for-waveforms dependencies if nothing else uses them.

Reminder (parallel-work rules): migrations run against the real DB only after landing, via the default workspace; pre-trunk they execute only on the lane's sandbox clone.

Note from issue 04: `PerfDiffViewer` is the last JSON-endpoint consumer (PRD listed it
untouched, but dropping the JSON columns breaks it). Resolve here: convert it to
`toThreeBands()` over the blob endpoint (small — it only needs low/mid/high arrays +
duration + cue time), or retire the diagnostic view.

## Acceptance criteria

- [ ] Migrations drop JSON/PNG columns and move `cue_point_time`; existing Main cues survive; single alembic head
- [ ] PNG pipeline, static mount, JSON endpoint, and legacy frontend types are gone
- [ ] Main cue set/read/persist works across library player, Performance view, and sync/divergence paths
- [ ] Full library regenerated to v2 (~1k tracks in minutes); DB size drops by ~4+ GB
- [ ] `uv run -m pytest`, `npx vitest run`, `npm run build` all green

## Blocked by

- `04-full-parity-all-surfaces.md`

## Comments

**2026-07-04 (wfproto lane, change `rqwtvtsu`)** — Implemented. Migration `0011_rqwtvtsu`:
`tracks.cue_point_time` added + values copied from waveform rows; `low/mid/high_peaks_json`,
`png_path`, `cue_point_time` dropped from waveforms (batch mode). `create_waveform` is
blob-only (no librosa anywhere — `waveform_utils.py` deleted); cue endpoints/sync paths
(`apply.import_maincue`, `bulk`, `sync_status.aggregator`) read/write the Track; the
"track has no waveform row" 409 for Main-cue import is gone (cue no longer needs one) —
`maincue_no_waveform` retained in the bulk report shape but is always 0. PNG static mount
removed; `populate_waveforms.py` deleted (task-sweep backfill covers it);
`invalidate_waveforms.py` simplified. Frontend: legacy waveform JSON types + `api.waveforms.get`
deleted; `Track.cue_point_time` exposed through schemas + types; DeckContext reads the saved
cue from the Track row and patches loaded tracks on cue-set; **PerfDiffViewer converted** to
`toThreeBands()` over the blob (resolving the issue-04 deviation — no JSON consumers remain).
Sandbox verified: migration ran on startup, cue PATCH round-trips to tracks, blob endpoint
healthy, **DB 5.0 GB → 225 MB after VACUUM**. 452 pytest / 197 vitest / tsc / build green.

**Post-landing steps (default workspace, real DB)**:
1. Start the backend once — auto-migrate runs 0010+0011; the startup sweep enqueues blob
   generation for all ~992 tracks (~5 min; waveform lanes 404 until each blob lands).
2. `sqlite3 data/library.db "VACUUM;"` — the dropped JSON pages don't shrink the file
   until vacuumed (5.0 GB → ~225 MB).
3. `rm -rf waveforms/` — the orphaned PNG directory.

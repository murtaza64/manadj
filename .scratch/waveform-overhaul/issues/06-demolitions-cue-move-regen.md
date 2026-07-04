# 06 — demolitions, Main cue move, full-library regeneration

Status: ready-for-agent

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

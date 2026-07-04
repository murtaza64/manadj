# 24 — BUG: beatgrid editing lost responsiveness in library view

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md`. Reported 2026-07-03.

## Symptom

In the library view, adjusting BPM no longer instantly adjusts the
rendered beatgrid — it used to update immediately.

## Hypotheses (diagnose before fixing)

1. **Selected-vs-loaded drift** (issue 23): the BPM edit may target one
   track (selected) while the waveform shows another (loaded), so the
   visible grid never updates — or updates only after a reload.
2. **Perf-pass regression**: the recent perf pass (autosave debounce,
   beatgrid geometry-space cache, dirty-keyed draws — change `vlloytsw`)
   may have debounced or under-invalidated the BPM → beatgrid → renderer
   path (cache key not including tempo, or the regenerated grid arriving
   only after the autosave debounce).

## Acceptance criteria

- [ ] Root cause identified and recorded here (comment section)
- [ ] BPM edits reflect in the visible beatgrid within one frame-ish
      (immediate by eye), in library view and editor rows
- [ ] No regression to the perf-pass wins (no per-frame grid rebuilds)
- [ ] If cause is (1), fold the fix into issue 23's scope rather than
      patching separately
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None - can start immediately. Coordinate with issue 23.

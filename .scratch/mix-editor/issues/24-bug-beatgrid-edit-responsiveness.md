# 24 — BUG: beatgrid editing lost responsiveness in library view

Status: closed (implemented change ptqonxkz; user-verified 2026-07-04)

Root cause (recorded per acceptance criteria): NOT the renderer — hypothesis
1-adjacent plus an ordering race. `handleBpmChange` fired the BPM PATCH
without awaiting (`mutation.mutate`), then immediately delete+regenerated
the beatgrid — the backend rebuilt it from the OLD `track.bpm`, and the
beatgrid query's `staleTime: Infinity` kept the stale grid until the next
edit. Rapid ±0.03 nudges interleaved whole sequences, compounding it. The
selected≠loaded mismatch (issue 23) additionally made edits invisible when
the selected row wasn't the loaded track. Fix: `onSave` is awaited
(`mutateAsync`), BPM commits serialize through a promise chain, and issue
23 retargets the editor to the loaded track. Renderer beatgrid cache was
verified correct (`setBeatgrid` nulls it).

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

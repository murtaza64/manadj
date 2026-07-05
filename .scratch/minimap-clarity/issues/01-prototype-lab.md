# 01 — Prototype lab: minimap mark-clarity variants

Status: ready-for-agent
Type: prototype

Build `?view=minimap-lab`, a dev-only page rendering the five variants from
`../PRD.md` stacked, with real track data and a synchronized synthetic
playhead. Throwaway code under `frontend/src/prototype/minimap/`; one
additive gate in the dev-view switch. **Never lands on main** (prototype
policy, docs/agents/parallel-work.md).

## Spec

- Track picker (reuse the `api.tracks.list` pattern from StyleTuningPage) +
  saved-transition picker for guide source; synthetic guide fallback.
- Data: `useWaveformBlob` → `toThreeBands`; `useHotCues`; track
  `cue_point_time`; `computePlayGuides` over `snapshotPairStore()`.
- Variants: baseline, edge-lanes, knockout-bars, quiet-body, hybrid — one
  Canvas 2D draw function each, labeled, at 30px and 44px.
- Shared controls: sweep speed + play/pause, click-to-scrub, played-dim
  toggle, hotcue palette toggle, loop-band toggle.

## Testing Decisions

Prototype constraints: no unit tests. Verification = `npm run build` passes
(type-checks) and a human walkthrough of the lab page against a real track
with hotcues + a saved transition.

## Comments

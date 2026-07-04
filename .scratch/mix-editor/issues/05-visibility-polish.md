# 05 — Visibility polish: lane endpoints + hotcue clarity

Status: done (2026-07-03, user-verified)

## Parent

`.scratch/mix-editor/PRD.md` (Editor tools). Prototype iteration
(MixEditorProto + one small renderer config knob).

## What to build

- **Lane endpoint visibility**: first/last breakpoints (the blend's
  entry/exit values) render larger (~8px) with a dark outline ring, clamped
  a couple px inside the strip so they never clip at x/y extremes (the line
  still hits the true edge). Hover any breakpoint → small value readout;
  endpoints show theirs persistently.
- **Hotcue clarity**: `waveformBrightness: 0–1` (default 1) in
  `WebGLRendererConfig`, scaling waveform band colors only — hot cue lines,
  badges, beatgrid, playhead stay full-strength (rides slice 01's
  premultiplied band-color path). Editor rows set ~0.6. Player, Practice,
  Performance, and minimaps unchanged (default).

## Acceptance criteria

- [ ] Endpoint at y=0 or y=1 clearly visible and grabbable at both strip ends
- [ ] Endpoint values readable at a glance; hover readout on interior points
- [ ] Editor rows: hot cues/beatgrid visually pop over a dimmed waveform;
      cue colors unchanged
- [ ] Other surfaces pixel-identical at default brightness
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately.

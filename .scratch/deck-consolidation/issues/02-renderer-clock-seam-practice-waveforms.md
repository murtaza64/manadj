# 02 — renderer clock seam + Practice waveforms

Status: ready-for-agent

## Parent

`.scratch/deck-consolidation/PRD.md`

## What to build

Make the waveform renderer depend on a clock interface instead of an audio element, collapse the twin component lifecycles into one shared hook, and give the Practice view real waveforms driven by the engine clock.

- Renderer accepts a clock (playhead, running state, rate) in place of `startRenderLoop(audioElement)`. Delete the jitter-compensation and telemetry machinery (interpolation baselines, startup prediction/blending, anomaly suppression, startup diagnostics, RAF-delay logging — ~500 lines): the engine clock is sample-accurate and monotonic, so the renderer just reads it per frame.
- One shared waveform-renderer hook owns the lifecycle (construct renderer, feed waveform/beatgrid/hot-cue/cue data, run/stop the loop, dispose); the full waveform and the minimap become thin configurations of it. Drag-to-scrub routes through the clock/engine interface (pause → seek → resume), not by mutating renderer fields.
- Practice view: scrolling waveform (playhead at 25%, drag-scrub, wheel zoom, beatgrid/hot-cue/cue markers) + minimap via the hook, driven by its engine. Delete the dumb canvas timeline; keep the time/bar readout.
- Library waveform components move onto the hook using a thin element-backed clock adapter so the library keeps working (temporarily unsmoothed — accepted interim state per ADR 0008's big-bang decision; issue 03 replaces the adapter with the engine clock).
- Delete the abandoned `waveform-webgl` prototype directory and its CORS whitelist entry.

## Acceptance criteria

- [ ] Practice view shows scrolling waveform + minimap; playhead motion is smooth and matches the audio (verify cue stabs and beatjumps land visually on the beatgrid ticks)
- [ ] Drag-to-scrub and wheel zoom work in the Practice waveform; minimap click-to-seek works
- [ ] The dumb canvas timeline is gone; time/bar readout remains
- [ ] Renderer contains no audio-element reads, no smoothing/interpolation/startup-prediction code, and no startup/anomaly telemetry
- [ ] Full waveform and minimap share one lifecycle hook (no duplicated init/sync effects)
- [ ] Library waveform + minimap still render and track playback via the element-clock adapter
- [ ] `waveform-webgl/` and its CORS entry are deleted
- [ ] `make typecheck`, frontend lint on touched files, vitest, and backend pytest all green

## Blocked by

None - can start immediately (01 recommended first as the safety net).

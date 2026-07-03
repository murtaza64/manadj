# 02 — Ride back the remaining real-module fixes from the prototype

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md` (Graduation, step 2). Source list:
`frontend/src/prototype/NOTES.md` "Real-module fixes made here that MUST ride
back to the main line".

## What to build

Land the prototype's real-module fixes on the main line as a reviewed change
(issue 01 covers the renderer driven-draw/windowed-geometry work; this issue
is the rest):

- `graph.ts` `rampGain`: read the computed current value BEFORE
  `cancelScheduledValues` — the reversed order freezes gains at their old
  anchor and buzzes at 60Hz under per-frame setter streams. Latent in the
  main line's `setEqValue` (masked by sparse slider events).
- `WebGLWaveformRenderer` CSS-resize handling in the render path and
  `setDisplayWindow` external windowing (already used by the prototype; ride
  back as part of the same renderer state if not already absorbed via 01).
- `WaveformMinimap`: optional `beatgrid` prop.
- `api.tracks.update`: declares `bpm` (keep alongside `key`).
- `DeckEngine`/`DeckGraph`: `setVolume` channel-volume setter (graduation
  target per ADR 0009 is the Mixer channel strip — coordinate with
  performance-mode work; if the Mixer refactor has landed, this may be
  subsumed).

Coordinate with the active performance-mode changes before touching shared
files; rebase-friendly, small, reviewable.

## Acceptance criteria

- [ ] Streaming `setEqValue`/gain ramps per animation frame produces smooth
      ramps (no 60Hz zipper) on the main line
- [ ] All listed fixes present on the main line with the prototype still
      working when rebased on top
- [ ] tsc, eslint on touched files, vitest, pytest green

## Blocked by

- `01-renderer-driven-draw-windowed-geometry` (renderer items overlap; land
  01 first so this issue shrinks to the non-renderer fixes)

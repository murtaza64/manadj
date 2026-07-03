# 02 — Ride back the remaining real-module fixes from the prototype

Status: done (2026-07-03, subsumed by the stack merge)

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

## Comments

Closed by the 2026-07-03 stack merge (mix-editor stack rebased onto the
performance-mode head, `jj rebase -s wukpkxoz -d oyxyrwrq -d krkmyxuk`):

- `rampGain` read-before-cancel fix ported into `mixer.ts` (the DeckGraph it
  originally patched was deleted by performance-mode 01; the Mixer's copy had
  the same latent bug).
- Renderer work (CSS-resize, setDisplayWindow, driven-draw, windowed
  geometry) now coexists with performance-mode's `setVisibleSeconds` on the
  unified line.
- `api.tracks.update` bpm/key: both sides had added identical declarations.
- `WaveformMinimap` beatgrid prop: carried in the prototype change, no
  conflict.
- `DeckEngine.setVolume`: obsolete — `MixProtoPlayer` now instantiates its
  own private `Mixer` (portFor A/B, setFader/setEq/setFilter), completing the
  ADR 0009 graduation alignment and replacing the two-context OS-summing
  hack with a real master bus + limiter.

There is no separate "main line" to ride back to anymore: the merged stack
is the single lineage (both workspaces' heads share it).

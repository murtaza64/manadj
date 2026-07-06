# 05 — `jumpBeats` displaces via the live grid

Status: ready-for-agent
Type: task

ADR 0027 §5. Beat jump is a beat-domain gesture computed from a tempo
scalar (`DeckEngine.ts:340-350`, `beats * 60/bpm`) while loops/quantize
at the same playhead use `addBeats` over `beat_times` — two authorities
for one gesture class.

## Change

- `DeckEngine.jumpBeats`: when the deck has a grid (≥2 beats, same guard
  as auto-loop), target = `addBeats(playhead, beats, beatTimes)`
  (`playback/quantize.ts:53-65` — phase-preserving fractional beat
  coordinates). Gridless fallback: today's `60/bpm` with the 120
  default.
- The engine bpm scalar and `useDeckBpmSync` stay (snapshot consumers:
  play guides; the fallback).
- Editor `beatsToSeconds` call sites left alone (inside the editor's
  blessed constant-BPM simplification).

## Testing decisions

- Off-phase regression (grill condition): playhead at beat coordinate
  k+0.25, jump ±N → lands at (k±N)+0.25 exactly; on a constant grid the
  result equals the old scalar math to float precision.
- Variable grid (after issue 04): jump across a tempo boundary lands N
  beats away by count, not by first-segment seconds.
- Gridless: unchanged behavior (existing test at
  `DeckEngine.test.ts:233` keeps passing).

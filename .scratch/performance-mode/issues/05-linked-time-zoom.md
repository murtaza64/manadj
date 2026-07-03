# 05 — Linked time-based zoom across both waveforms

Status: ready-for-agent

## Parent

`.scratch/performance-mode/PRD.md`

## What to build

One shared zoom for the two stacked waveforms, measured in time (visible seconds), so beat spacing is visually comparable across decks — the basis of visual beatmatching.

- The renderer gains a set-zoom-by-visible-seconds operation. The current `zoomFactor` is track-length-relative (zoom 16 on a 3-minute track shows a different timespan than on a 7-minute track), which breaks cross-deck comparison; the conversion (visible seconds ↔ zoom factor given duration) is a pure function under vitest.
- The Performance view holds a single zoom value (seconds visible) applied to both waveforms; wheel zoom on either waveform updates the shared value. Min/max clamps expressed in seconds.
- The library view's single waveform keeps its current behavior (its own zoom, unshared).

## Acceptance criteria

- [ ] At any zoom level, one beat at equal effective BPM spans the same pixels on both waveforms (spot-check with two tracks at matched tempo)
- [ ] Wheel zoom over either waveform zooms both; zoom survives loading a new track onto either deck (seconds view is preserved, factor recomputed per duration)
- [ ] Pure seconds↔factor math under vitest, including clamp behavior and degenerate durations
- [ ] Library view zoom behavior unchanged
- [ ] `make typecheck`, eslint on touched files, vitest, pytest all green

## Blocked by

- 03-performance-view-surface

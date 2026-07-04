# 05 — Linked time-based zoom across both waveforms

Status: done (implemented, change wpmrymwr)

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

## Comments

Implemented in jj change `wpmrymwr` (performance-mode: 05-linked-time-zoom) — pulled ahead of issue 04 after user hit the bug live (two 174 BPM tracks scrolling at different speeds).
- `utils/waveformZoom.ts` (+14 tests): pure seconds↔factor conversion. `zoomFactorForVisibleSeconds = duration / clampVisibleSeconds(s)`, floor 1 (never wider than the track), ceiling `MAX_ZOOM_FACTOR = 400` (geometry guard rail — the renderer builds whole-track geometry, so a 2-hour file at 4s visible would be GB-scale; >27-min files degrade gracefully instead). Seconds clamps 4–240, default 20, wheel step 1.2 (`stepVisibleSeconds`).
- Renderer: `setVisibleSeconds(seconds)` — deliberately bypasses the track-relative min/max factor clamps (they would reintroduce the duration dependence). Verified: backend waveform bins are fixed-size in time (128 samples/peak), so data-point fraction ≡ time fraction and the math holds.
- `WebGLWaveform`: optional `visibleSeconds`/`onVisibleSecondsChange`; in linked mode wheel reports a step to the parent instead of zooming locally; an effect re-applies the shared value after every renderer re-creation (zoom survives loads). Props absent → old behavior (library unchanged).
- `PerformanceView`: one `useState(DEFAULT_VISIBLE_SECONDS)` feeding both `DeckWaveform`s.
- Eye-verification pending user: equal beat spacing at matched tempo; wheel on either waveform zooms both.

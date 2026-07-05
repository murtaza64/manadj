# Waveform rendering respects Jump events

Status: needs-triage

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

The Transition editor's timeline draws the incoming Track's waveform with the base (no-jump) linear alignment mapping: `bTrackTime = bInSec + (mixTime − startSec) · rateB`. A Transition with Jump events plays back piecewise (`bTrackTimeAt` re-adds each delta at its instant — issue 01), so past a jump marker the on-screen audio no longer matches what plays: a doubled buildup shows the post-jump content while replaying the pre-jump stretch. Accepted as a v1 approximation in issue 01 ("the AUDIO is authoritative"); this issue removes it.

The incoming row's waveform (and anything else derived from the linear mapping) should render the **piecewise** arrangement: B's drawn content re-anchors at every Jump event, so what's under the playhead is always what's audible. Likely touch points: the B display-window mapping in the timeline's rAF tick, the B block frame / inaudible-head overlays, the minimap's B block, and the beat/cue guide mapping over the transition window — each currently assumes one linear segment.

## Acceptance criteria

- [ ] With a backward jump (doubled buildup), the audio under the playhead visually matches what plays on both sides of the jump instant
- [ ] Content between jump segments shows a visible seam/boundary at the jump marker (no pretending the audio is continuous)
- [ ] B's block frame and greyed inaudible regions reflect the piecewise footprint (including a jump past B's end ending the block early, and a jump below B's start greying the gap)
- [ ] Beat guides and hot-cue guides in the lane strips map through the piecewise arrangement
- [ ] GlobalMinimap's B block agrees with the main rows
- [ ] Scroll/zoom performance stays within the editor's existing budget (dirty-keyed tick; no per-frame full redraws at idle)
- [ ] Pure mapping math (mix time ↔ B track time per segment) lives in mixModel alongside `bTrackTimeAt` and is vitest-covered

## Blocked by

None - can start immediately (issue 01 landed 2026-07-05)

## Further notes

- The renderer draws one contiguous display window per row (`setDisplayWindow`); piecewise content likely means either segmented draw calls per jump span or splitting the B row into per-segment canvases. Whichever way, keep the one-motion-clock rule (all horizontal motion applied in the same rAF tick).
- Jump-heavy Transitions are small in practice (a handful of segments); per-segment iteration in the tick is fine — avoid premature cleverness.

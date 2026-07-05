# Waveform rendering respects Jump events

Status: ready-for-agent

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

The Transition editor's timeline draws the incoming Track's waveform with the base (no-jump) linear alignment mapping, but a Transition with Jump events plays back piecewise (`bTrackTimeAt`). Make everything drawn agree with what plays.

Grilled 2026-07-05; decisions:

- **Visual language: DAW splice.** Each segment draws its own audio normally, re-anchored at every jump instant. The existing cyan jump marker IS the seam (brighten it slightly — it gains meaning). A backward jump shows the same audio twice, side by side — that's the truth; no ghosting, no dimming of repeated content. A forward jump's skipped content simply doesn't appear.
- **Renderer mechanism: multi-pass scissor on the existing B canvas.** `WaveformRendererV2` grows a segments variant of its frame render: per segment, `gl.scissor` + `gl.viewport` to the segment's x-range and one body pass with that segment's display window (`FrameView` gains an x-offset/width; `drawBody` already derives everything from the struct). Pixel-snap (ADR 0015) applies PER SEGMENT or peak heights shimmer at seams. The WebGL overlay pass (beatgrid/hot cues) needs per-segment `timeToX`. Rejected: stacked renderer instances (duplicated data textures + browser WebGL-context cap ~8–16 is a real cliff); shader-level segment remap (touches the shared `BODY_MAIN` contract across all Waveform styles for no net win — overlays/modulation need CPU-side segment math regardless).
- **One walk in the model.** Export from `mixModel`, beside `bTrackTimeAt`:
  `bContentSegments(tr, durB, rateB) → [{ mixStartSec, mixEndSec, bStartSec }, …]`
  — active segments only (jump-below-zero gaps and post-end are simply absent). vitest-covered; `bEndMixTime` refactored to derive from it (behavior-frozen — existing tests stay green).
- **Scope: all six consumers, one issue** (the value is coherence — a spliced body under un-spliced beatgrid overlays trades one lie for a subtler one):
  1. B row body (the multi-pass)
  2. B row WebGL overlay pass (beatgrid lines, hot-cue marks — per-segment mapping)
  3. `.editor-blockframe.b` / `.editor-inaudible` → per-segment divs (gaps greyed, jump-past-end truncates the block)
  4. `guidesB` + the envelope-preview modulation LUT mapping (per segment)
  5. GlobalMinimap: swap its linear `bTrack` formula for `bTrackTimeAt` (per-column loop renders discontinuities for free)
  6. `zoneAt` hit-testing: the `bMove` grab region uses the piecewise footprint
  If anything must be cut, cut (6) — an affordance wart, not a lie about audio.

## Acceptance criteria

- [ ] With a backward jump (doubled buildup), the audio under the playhead visually matches what plays on both sides of the jump instant; the repeated stretch appears twice
- [ ] Segments butt at the jump marker (the seam); marker line slightly brightened
- [ ] Per-segment pixel-snap: no peak shimmer at seams while scrolling/zooming (ADR 0015)
- [ ] Beatgrid lines and hot-cue marks on row B land on the spliced audio, not the base mapping
- [ ] Block frame and inaudible overlays reflect the piecewise footprint (gap segments greyed/absent; jump past B's end truncates)
- [ ] Lane-strip beat/cue guides and envelope preview shading map through segments
- [ ] GlobalMinimap's B block agrees with the main row
- [ ] `bMove` grab zones follow the piecewise footprint
- [ ] `bContentSegments` in mixModel, vitest-covered (doubled buildup, forward-past-end truncation, below-zero gap, zero-duration window, sub-pixel-width segments skipped at draw time); `bEndMixTime` derives from it with existing tests green
- [ ] Idle editor still draws nothing (dirty key unchanged — jumps already feed `modelVersionRef`); `?protoperf` worst-tick comparable to before on a jump-heavy Transition

## Blocked by

None - can start immediately

## Further notes

- One-motion-clock rule holds: segment windows + draws happen inside the existing rAF tick, renderers stay in driven mode.
- Uniform locations aren't cached in `drawBody` (fetched per frame per name); N segments multiplies that overhead — cache locations if `?protoperf` complains, not before.
- Jumps per Transition are few (single digits); per-segment iteration in the tick is fine — no premature cleverness.

## Comments

Grilled 2026-07-05 (visual language, renderer mechanism, walk location, scope). No ADR: everything sits inside ADR 0015's existing constraints, applied per segment.

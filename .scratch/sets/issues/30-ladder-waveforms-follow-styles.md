# 30 — Ladder waveforms follow the global Waveform styles

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (feedback 2026-07-05)

## Problem

The overview ladder's clips render waveforms via a private 2D-canvas path (`toThreeBands` + hardcoded band colors, inherited from the prototype/GlobalMinimap idiom). They ignore the app's **Waveform style** system (glossary: a named render recipe — shader variant + tunable display parameters — that the player surfaces honor and the styles mode edits live). Tweaking a style changes the players but not the ladder; the Set view looks like a different app.

## What to build

Ladder clip waveforms render according to the active global Waveform style — same source of truth the player/minimap renderers use (style slots), updating live when styles change.

Implementation constraints (agent's choice within them):

- **Do not spawn a WebGL context per clip** — a set has 40+ clips; browsers cap live WebGL contexts far below that. Options include: a CPU/2D interpretation of the style's parameters (band grouping, per-group gains, gamma, smoothing, colors) applied in the existing canvas loop; or shared-context/atlas rendering (one offscreen renderer rasterizing clips). Pick pragmatically; note the choice in the park comment.
- Style *fidelity* target is "recognizably the same style", not shader-perfect — clips are ~40px tall; document any deliberate simplifications.
- Live update: switching/tweaking a style (styles mode) re-renders the ladder without reload; per-frame cost must not regress ladder scrolling.
- If the mirrored-lane layout (bars anchored to the center line) conflicts with a style's notion of orientation, the ladder's mirroring wins — it's layout, not style.

## Acceptance criteria

- [ ] Ladder clips visibly reflect the active Waveform style (colors/band mix/gamma), matching the player's rendering character
- [ ] Editing a style in styles mode updates the ladder live
- [ ] No per-clip WebGL contexts; ladder scroll performance unregressed
- [ ] Mirrored lanes, dimming, cue marks, and bands unchanged in behavior

## Notes

- `OverviewLadder.tsx` has no active lane claim (rows bundle done; 22 touches rows/toolbar, not ladder internals; 25 is Conductor files) — dispatchable now to an idle lane; check `.lanes/` at dispatch time anyway.

## Blocked by

—

# 30 — Ladder waveforms follow the global Waveform styles

Status: ready-for-human

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

## Comments

- 2026-07-05 (lane setsugg, change `zrxsrozm`) — implemented, parked ready-for-human.

  **Mechanism (constraint: no per-clip WebGL):** CPU/2D interpretation — new
  module `frontend/src/sets/ladderWaveStyle.ts` hand-ports the V2 shader's
  style math (amp/dequant + displayGamma, LOD-pyramid peak max / band mean
  sampling, group RMS -> gains -> soft-knee limit -> master, all 8
  `styleColor` variants) and renders each canvas column as piecewise-constant
  vertical segments between the style's height thresholds — exact for every
  current style, no shared-context/atlas needed. The ladder follows the
  **minimap slot** (`useStyleSlot('minimap')` — the players' overview-strip
  source of truth); live update rides the same `useSyncExternalStore` path
  the GL surfaces use. A registry-coverage test fails if a style is added
  without a CPU twin.

  **Documented simplifications:** columns are CSS px; time constant within a
  column (transient-flux samples at column midpoint); no modulation pass;
  mirrored-lane orientation wins over style anchor (issue constraint); full
  brightness (the GL minimap's 0.55 body dim exists so its full-height
  markers pop — ladder clips have no such markers).

  **Perf:** ~3µs/column (measured on a real multi-LOD blob, all styles
  ≤3.2µs) — a max-zoom clip ≈ 10ms, redrawn only at zoom-settle/style
  change; scrolling never redraws (unchanged static-canvas design).

  **Verification:** gate green (pytest 666, build, vitest 1081 incl. 9 new
  unit tests, alembic single head, eslint clean on touched files); one-off
  real-blob smoke exercised all 8 styles × multi-level LOD × both zoom
  regimes (temp test, deleted).

  **Walkthrough** (lane app running): open http://localhost:5283 (desktop
  shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5283`)
  1. Library view -> open set "review-17" -> the overview ladder above the
     track list now renders clips in the minimap Waveform style (default
     additive-RGB: red/green/blue with additive overlap cores) instead of
     the old hardcoded red/green/lightblue bars.
  2. TopBar -> styles view -> pick the **minimap** slot radio -> switch the
     style (e.g. "Layered opaque (3Band)" or "Spectral hue") and drag
     gains/colors/gamma.
  3. Switch back to the library view: the ladder reflects every tweak (no
     reload) and matches the deck minimaps' character.
  4. Unchanged: mirrored lanes at the center line, cue lines/triangles,
     adjacency bands, grace fades; scroll/zoom feel (canvases still redraw
     only ~150ms after a zoom gesture settles).

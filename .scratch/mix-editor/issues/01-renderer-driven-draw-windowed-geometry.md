# 01 — Timeline render/motion layer: driven draw + windowed geometry

Status: done (2026-07-03)

## Parent

`.scratch/mix-editor/PRD.md` (Graduation, step 1). ADR 0009/0010 context.

## What to build

The first graduation slice: make the Transition editor's zoom smooth and its
layers tear-free by productionizing the shared waveform renderer, in place.

- **Driven-draw mode**: the renderer exposes a public "render one frame now"
  call; the self-running rAF loop becomes a convenience wrapper around it.
  The editor's single motion clock (its rAF tick) calls it for both row
  renderers immediately after writing DOM transforms and display windows —
  layer ordering is guaranteed by construction instead of rAF registration
  luck. The renderer hook grows a `driven` option; default behavior
  (self-driving) is unchanged for all other surfaces.
- **Windowed geometry**: when an external display window is active, geometry
  is generated only for the visible window plus ~one viewport of margin on
  each side — cost constant in zoom level, replacing the full-track
  regeneration that ran on every zoom-gesture frame. Panning regenerates only
  when the view exits the margin. Minimap/full-track consumers keep
  full-track geometry.
- **Allocation/upload hygiene**: geometry built into a preallocated
  Float32Array (no growing number[] churn); vertex buffers uploaded to the
  GPU only when geometry actually changed (currently re-uploaded every frame,
  even idle); beatgrid vertex arrays cached keyed on the display window.

Decided in the 2026-07-03 grill (prototype v9 follow-up): evolve the shared
renderer rather than fork a timeline-specific one; rows A/B are driven, the
editor minimap stays self-driven; the per-zoom-frame flushSync React commit
stays and is re-measured after this lands.

## Acceptance criteria

- [ ] Continuous wheel-zoom on the 549→171 pair is smooth at fit and deep
      zoom; waveforms stay aligned with block frames/ruler during gestures
      (no one-frame shift, no drop-behind)
- [ ] Geometry regeneration during zoom is O(viewport), not O(track/zoom)
- [ ] No per-frame gl.bufferData uploads when nothing changed
- [ ] Player, Practice/Performance surfaces, and minimaps behave unchanged
      (self-driving default path untouched by ear and eye)
- [ ] tsc, eslint on touched files, vitest green
- [ ] Temporary frame-time instrumentation removed (or inert behind a flag)
      before ride-back

## Blocked by

None - can start immediately.

## Comments

Done in jj change `mix-editor: 01-renderer-driven-draw-windowed-geometry`
(okrnmltp). All criteria met; user-verified zoom feel ("perfect now").
Two extra renderer fixes surfaced during verification and are included:

- Exact cache range epsilon for externally-windowed views (0.1% guard reused
  stale-scale geometry during smooth zoom gestures → drift-and-snap).
- `calculatePixelOffset()` computed after cache refresh in `render()` — was
  read from the previous frame's cacheValidation, drawing fresh geometry
  with a one-frame-stale zoom mapping. Latent main-line bug (one bad frame
  per Player zoom step); rides back with this renderer work.

`?protoperf` frame-time readout left inert behind the URL flag; strip at
ride-back review.

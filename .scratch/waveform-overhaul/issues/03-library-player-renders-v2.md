# 03 — library player renders from v2 (production renderer core)

Status: ready-for-agent

## Parent

`.scratch/waveform-overhaul/PRD.md`

## What to build

The library player's waveform (Deck A) renders from v2 Waveform data via a new production waveform module, swapped in behind the existing renderer-lifecycle hook seam. The module contains:

- a pure blob decoder (bytes → header + typed arrays)
- the texture renderer core, carrying the prototype-validated invariants (ADR 0015): tiled LOD data textures, client-built pyramids with channel-true aggregation (peaks max / bands mean), fragment-shader column rendering with hard-max peaks and box-filter-mean bands, pixel-snapped view origin, zoom/pan/scrub as uniforms
- the Waveform style registry: shader variants + shared typed params, default = additive RGB "B" with the tuned defaults (gains 0.7/1.05/1.5, group boundaries 3/5)

`frontend/src/prototype/ProtoWaveformGL.ts` is the reference implementation — rewrite properly (it was written under prototype constraints), don't move it. Core interactions must work on the swapped surface: playhead-following at 25%, wheel zoom, drag scrub. Full overlay/surface parity is issue 04.

## Acceptance criteria

- [ ] Library player waveform renders from the v2 endpoint (no JSON fetch on this surface)
- [ ] Style registry exists with typed params; default style/params match the tuned B
- [ ] Renderer honors ADR 0015 invariants (pixel snap, max/mean aggregation, no geometry for the body)
- [ ] Playhead follow, wheel zoom, drag scrub work; no regression in the library player's feel
- [ ] Decoder vitest tests pass against the committed golden blob
- [ ] `npx vitest run` and `npm run build` green in `frontend/`

## Blocked by

- `01-v2-blob-generation-and-endpoint.md`

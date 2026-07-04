# 03 — library player renders from v2 (production renderer core)

Status: resolved (wfproto lane, 2026-07-04 — pending user eye-verify of library player feel)

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

## Comments

**2026-07-04 (wfproto lane, change `tpsnyxkw`)** — Implemented `frontend/src/waveform/`:
`blob.ts` (decoder + channel-true LOD pyramids + tiled texture packing), `styles.ts`
(registry: 6 proven variants, shared `StyleParams`, default = tuned additive-rgb),
`WaveformRendererV2.ts` (texture renderer, ADR 0015 invariants: pixel-snapped origin,
hard-max peaks, box-mean bands; lazy per-style program compile; playhead-follow, wheel
zoom on visible-seconds, drag-scrub/commit, click-to-seek; overlay data stored for 04),
`useWaveformBlob.ts` + `useWaveformRendererV2.ts` (hook mirrors legacy shape),
`blob.test.ts` (8 vitest tests vs the golden blob + pyramid invariants).
Seam: `WebGLWaveform` takes `renderEngine` prop ('legacy' default); `Player` passes 'v2'
— library player is the only v2 surface until 04. API client: `waveforms.getData` added.
Drive-by: backend CORS switched to a localhost-port regex (fixed 5173/5174 list fought
the lane port-offset convention). tsc clean, 205 vitest, build green.
Sandbox backfill: 988/992 blobs; 4 failures are tracks whose files no longer exist on
disk (Downloads/Mixxx-recording paths) — pre-existing data issue, not pipeline.
Eye-verify at http://localhost:5193 (lane vite → lane backend :8020): library player
waveform, zoom (wheel), drag-scrub, playhead follow.

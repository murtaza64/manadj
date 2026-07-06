# 39 — Ladder GL surface: shared-context rendering for realtime zoom

Status: deferred (nice-to-have — human call 2026-07-06; revisit if ladder
smooth zoom/per-frame animation becomes a priority)

## Parent

.scratch/sets/PRD.md (follow-up to 30, filed from the sets 30 review
session)

## Problem

Issue 30 gave ladder clips style-slot fidelity via a CPU/2D port
(`sets/ladderWaveStyle.ts`), chosen to dodge the browser's live-WebGL-
context cap (40+ clips). CPU redraw is ~5-8µs/column all-in, so the ladder
redraws crisp only at zoom-settle (80ms debounce) and covers the gesture
with CSS stretching (mitigated by 2x horizontal supersampling). Realtime
redraw on the CPU is 3-20x over frame budget (full ladder: ~18k columns ≈
50-120ms at default framing, ~50k ≈ 150-300ms at max zoom). Meanwhile the
players zoom smoothly for free because they're fragment shaders over
textures — the GPU repaints the viewport per frame.

## What to build (when un-deferred)

The context cap doesn't force CPU — the shared-context approach from
issue 30's constraints: **one WebGL canvas spanning the ladder viewport**
(single context, no cap), drawing every visible clip as a quad in one
pass.

- Reuse the existing shader prelude + style registry verbatim
  (`WaveformRendererV2` BODY_PRELUDE, `waveform/styles.ts`) — the CPU
  port's fidelity/divergence-maintenance burden disappears; styles and
  live tuning arrive via the same uniforms as the players.
- Per-frame cost = viewport pixels on the GPU → realtime zoom, scroll,
  and future per-frame effects (e.g. live played-portion dimming) become
  free.
- Cue poles/flags, titles, adjacency bands, grace fades stay DOM/2D
  overlays as today; mirrored-lane geometry moves to the vertex stage.

## Costs / risks (why it's deferred)

1. **Texture memory**: every visible track's peak+band packs in one
   context — ~40 tracks ≈ 50-100MB GPU. Needs upload-on-visible + LRU
   eviction; bookkeeping that doesn't exist today.
2. **Renderer restructure**: `WaveformRendererV2` is one-track/one-canvas.
   The ladder needs a multi-track variant (per-clip uniforms/instancing) —
   a new module sharing the prelude, roughly issue-30-sized.
3. It **replaces** most of 30's CPU port rather than extending it; the 2D
   port either becomes fallback/test-oracle or gets deleted.

## Acceptance criteria (draft)

- [ ] Ladder zoom/pan re-renders per frame, no CSS-stretch interim
- [ ] Single WebGL context regardless of clip count
- [ ] Style parity with the players (same slot, same shader variants)
- [ ] GPU memory bounded (visible-clip uploads, eviction) — no regression
      opening a 40+ clip set
- [ ] Cue marks, titles, bands, fades, dimming behavior unchanged

## Blocked by

—

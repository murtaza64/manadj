# 02 — Zoned marks + played-dim in the minimap renderer

Status: ready-for-human
Type: task

## Parent

`../PRD.md` (Verdict section) — prototype-validated in issue 01.

## What to build

Port the "Zoned marks" vocabulary and the played-portion dim into the real
track minimap (the WebGL renderer's minimap mode). Full-waveform mode is
untouched. This is a fresh implementation — prototype code is never
promoted; the lab (`?view=minimap-lab`, lane change oyrprrqt) is the visual
reference, not a source.

Geometry (from the prototype — the decision, in px at 30px strip height):

- **Hotcues**: 2px full-height pole + 5×5px square flag hanging off the
  pole's top RIGHT (flag spans x+1..x+6, y 0..5). Per-slot colors as today;
  alpha ~0.95.
- **Main cue**: 2px full-height yellow bar (as today) + triangle at the
  BOTTOM edge (halfwidth 5px, depth ~8px) — moved from the top, where it
  sits today.
- **Playhead**: unchanged (3px pink, the widest mark).
- **Played-portion dim**: black wash at 0.35 alpha over the waveform body
  from x=0 to the playhead. Marks stay full brightness — draw order body →
  dim → marks. Always on; no toggle.

Note for later (looping issue 05 owns it): when an active loop exists and
the playhead is inside it, the dim wash stops at the loop's left edge.

## Acceptance criteria

- [ ] Minimap hotcues render as poles + top-right square flags in slot
      colors; distinguishable from the main cue at a squint
- [ ] Main cue triangle sits at the bottom edge of the minimap (top edge
      unchanged on the full waveform)
- [ ] Body left of the playhead is dimmed 0.35; marks in the played region
      keep full brightness; boundary tracks the playhead smoothly
- [ ] Full-waveform rendering is pixel-identical to before
- [ ] Visible in Performance deck panels, TagEditor minimap, and the style
      tuning page's minimap preview

## Blocked by

None - can start immediately.

## Comments

**2026-07-05 — implemented (lane minimap-clarity, change xlnwqstv), parked ready-for-human.**

- `WaveformRendererV2.ts` minimap-mode only: hotcues are a 2px full-height
  pole (centered on the cue time) + 5×5 square flag off the pole's top
  right, per-slot colors, alpha 0.95 (new `u_alpha` uniform in the overlay
  FS); main cue keeps its 2px yellow bar, triangle moved to the BOTTOM
  (halfwidth 5px, depth 8px); playhead untouched; played-portion dim is a
  0.35 black wash from x=0 to the playhead drawn between body and marks,
  always on.
- Dim + hotcue passes blend with `blendFuncSeparate(..., ZERO, ONE)` —
  writing src alpha into the canvas would make it semi-transparent and
  composite the page background through as a gray wash (caught in headless
  verification, pixel-measured: backdrop 144→94 = exact ×0.65).
- Full waveform unchanged: all new geometry is inside `isMinimap` branches;
  the hotcue blend change is rgb-identical at u_alpha=1 with dst alpha
  already 1. Latent note: the dim is skipped under segmented rendering
  (`skipPlayhead`), which minimaps never use today.
- Gate: vitest 817, build + tsc + eslint clean, no backend changes.

**Verification walkthrough (lane app at http://localhost:5273):**

1. Performance view, load track 9 ("Calling For A Sign") on A and 171
   ("Last Time") on B (or any tracks with hotcues + a cue point).
2. Deck A minimap: 5 hotcue poles flying small square flags at the top
   right, slot colors; squint — they read differently from the yellow
   main-cue bar.
3. Deck B minimap: yellow main-cue bar near the start with its triangle at
   the BOTTOM edge (was top).
4. Play or scrub A mid-track: body left of the playhead dims, boundary
   rides the playhead smoothly; poles/flags in the played region stay full
   brightness.
5. Top full waveforms: unchanged (no dim wash, cue triangle where it was).
6. `?view=styles`: minimap preview renders with the same vocabulary.

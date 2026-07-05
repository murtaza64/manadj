# Waveform loop region rendering

Status: ready-for-agent

## Parent

`.scratch/looping/PRD.md`

## What to build

Render the Active loop on the waveforms: a translucent bright, saturated green fill spanning the region plus solid green edge lines at its boundaries (green = active state color, never a Deck color), alpha low enough that waveform peaks stay readable. Drawn on both full-width waveforms (Performance deck waveforms and the library player) and as a thin green band on the minimap — where "the loop is holding me here while I browse" is most legible.

Renders only while a loop is active — the translate-on-jump model means there is no armed-but-elsewhere state to depict. The region derives per-frame from the Deck snapshot (like the playhead), so it translates automatically when a beat jump moves the loop and resizes live under halve/double.

This is the waveform renderer's first filled-region overlay primitive: build it as a general shaded-region capability (alpha-blended rect in the existing overlay pass), since manual loop in/out and Saved loops will reuse it.

## Acceptance criteria

- [ ] Active loop shows as translucent green fill + green edge lines on Performance and library full waveforms, correctly positioned at all zoom levels
- [ ] Thin green band on the minimap over the same region
- [ ] Nothing renders when no loop is active; region disappears on release/cancel/Load
- [ ] Region follows live: translates on beat jump, resizes on halve/double, frame-accurate against the moving waveform
- [ ] The shaded-region primitive is a reusable overlay capability, not loop-specific plumbing

## Blocked by

- `03-minimal-audible-loop.md`

## Comments

**2026-07-05 (lane minimap-clarity)** — minimap loop visuals were prototyped
in the minimap-clarity lab; human-approved verdict to converge on
(.scratch/minimap-clarity/PRD.md):

- Loop color `#00f900`, region wash at ~0.18 alpha (full height on the
  minimap, not just a thin band).
- The 2px solid guide line sits at the TOP edge of the minimap strip — the
  bottom edge is the waveform body's zero line, keep it clean.
- Interaction with played-portion dim (minimap-clarity issue 03): while the
  playhead is inside an active loop, the dim wash stops at the loop's left
  edge — the loop body is about to replay, never "already heard".

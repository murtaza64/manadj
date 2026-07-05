# 05 — Seek, playhead, follow — and the free ladder

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Rewritten 2026-07-05 after the 03/04 review grill: the ladder's scroll-pin
to the list is retired (it breaks when a Set fits one screen, and hard
invariants between the two surfaces are unkeepable); the ladder becomes a
free timeline, and the two surfaces converge on EVENTS only.

**Seek** (unchanged scope): seek = plan evaluation at a mix-time instant —
active track(s), deck positions, lane values mid-window, tempo state —
legal into the middle of a Transition and while paused (positions without
playing). Clicking the overview ladder seeks (replacing 03's placeholder
navigate-on-click). Playhead line in the ladder; active row highlighted in
the list. Transport gestures are Conductor controls, not takeover triggers.

**Free ladder (replaces the 03 scroll-pin wholesale)**:

- Decoupled surfaces: ladder pan/zoom and list scroll are independent; no
  standing invariant links them. Remove 03's pinned-progress machinery,
  the visible-span clip dimming, and the zoom-1 band-aid.
- Pan: native horizontal scroll. Zoom: vertical wheel over the ladder
  (waveform convention; pinch/ctrl+wheel too), anchored at the cursor's
  mix-time — at the playhead instead while follow is engaged. Range: from
  fit-whole-set (clamp, set-length dependent) to ~8s of mix per 100px.
  Default framing on open: fit the whole set. Viewport (zoom + pan) joins
  the Set-view state in setStore (survives mode switches).

**Convergence contract** (the only ladder↔list coupling):

1. Seek (ladder click, row ▶, any seek): ladder pans — animated, zoom
   unchanged — only if the playhead lands outside the viewport (center
   it); list scrolls the active row into view; follow re-engages.
2. Playback with follow on: ladder auto-scroll is DAW-style PAGED — pan
   when the playhead crosses ~70–80% of the viewport, never per-pixel
   centering; list scrolls the active row into view at track-change
   boundaries only.
3. Follow disengages on manual ladder pan or manual list scroll; zoom
   never disengages it; re-engage by seeking or the follow button (⌖ on
   the ladder). On when playback starts.

## Acceptance criteria

- [ ] Seeking mid-window reproduces the same audio state as playing into that instant
- [ ] Ladder click seeks; playhead and active-row highlight track playback
- [ ] Seek while paused positions without starting
- [ ] Ladder pans/zooms freely; a one-screen Set is fully visible at default framing
- [ ] Follow: paged ladder auto-scroll + track-boundary list scroll; disengaged by pan/scroll, not by zoom; re-engaged by seek
- [ ] Seeking never stops the Conductor

## Blocked by

- 04-conductor-v1

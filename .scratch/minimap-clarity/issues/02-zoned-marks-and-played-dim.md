# 02 — Zoned marks + played-dim in the minimap renderer

Status: ready-for-agent
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

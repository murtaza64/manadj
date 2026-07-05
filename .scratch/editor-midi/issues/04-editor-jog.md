# 04 — Editor jog: scrub A / Slide B

Status: ready-for-agent

## Parent

`.scratch/editor-midi/PRD.md`

## What to build

The jog gesture class, with the performance side's three-tier feel:

- Jog joins the surface handle (rim ticks, touch-surface ticks, shifted-rim
  ticks); the shared surface delegates to the existing jog controller
  (bend/seek/fine/fast) unchanged.
- Editor deck A: velocity-scaled mix scrub — rim = normal, touch = fine,
  SHIFT+rim = fast. Works while playing (the mix transport hard-syncs on
  seek) and paused.
- Editor deck B: velocity-scaled continuous Slide (the generalization of
  the ±10ms Alignment nudge) with the same three tiers. Sketch edit;
  playhead's mix position never moves; paused re-park behavior matches the
  on-screen Slide gestures.
- No bend in the editor (the mix transport has no rate nudge) — rim ticks
  while playing scrub, never bend.

## Acceptance criteria

- [ ] Performance/library jog feel unchanged
- [ ] Editor: jog A scrubs the mix smoothly in all three tiers, playing and
      paused; jog B Slides in all three tiers
- [ ] Slide via jog autosaves like other alignment gestures
- [ ] Pure tier/velocity → delta math under vitest (prior art: jog suite)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-gesture-class-handle-pads

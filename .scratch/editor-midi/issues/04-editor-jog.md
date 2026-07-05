# 04 — Editor jog: scrub A / Slide B

Status: done

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

## Comments

- 2026-07-05 (edmidi lane): implemented in jj change `omzvxory` (pure
  delta-port test follow-up in `yqrptvsm`). `jog` section on the surface
  handle (rimTicks / touchTicks / shiftRimTicks per the ADR's vocabulary);
  shared surface delegates to the deck jog controller — feel constants
  untouched. Editor reuses JogController over two ports: A = mix scrub
  (`isPlaying` pinned false so rim ticks always seek — the mix transport
  has no bend; getPlayhead = getMixTime, seek = player.seek); B = delta
  port (getPlayhead pinned 0 → seeks become signed slide-by-seconds through
  `slideDeckB('beats', Δ)`, so re-park + autosave match the on-screen Slide
  gestures). NOTE for feel check: the bare-rim tier is the performance
  side's strictly-linear paused nudge (only SHIFT+rim is velocity-
  accelerated) — mirrors the jog suite's tiering; judge on hardware whether
  the editor rim wants acceleration. Status → ready-for-human: HARDWARE
  SMOKE TEST — editor: jog A scrubs the mix (rim gentle, touch fine,
  SHIFT+rim fast) while playing AND paused; jog B Slides in the same three
  tiers, playhead never moves, paused re-park matches on-screen slides, and
  a Slide via jog persists (reload the pair). Performance/library jog feel
  unchanged (bend while playing, seek paused, touch fine, release
  continuation).
- 2026-07-05 (edmidi lane): hardware smoke tests verified by the user; closed (jj change `owmzxpnt`).

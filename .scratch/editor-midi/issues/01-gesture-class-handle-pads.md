# 01 — Gesture-class handle + pads in both modes

Status: ready-for-agent

## Parent

`.scratch/editor-midi/PRD.md`

## What to build

The ADR 0019 refactor, proven end-to-end through the pads class:

- The audible-surface handle grows optional gesture-class sections (pads
  now; jumps/jog land in later slices without reshaping the handle).
  Dispatch routes pad gestures (hot cue down/up/clear) through the arbiter;
  an unregistered class drops, like CUE on the editor today.
- The shared surface registers its existing pad behavior (set-at-playhead /
  jump / hold-preview / SHIFT-clear) — zero behavior change in library and
  Performance views.
- The editor surface registers its gestures: set slot → jump the mix to the
  cue (deck A) / Slide the cue under the playhead (deck B); empty slot →
  set at that deck's track playhead; SHIFT+pad → clear; release → no-op.
- Leaving the editor restores shared routing (claim/release already flips
  the audible holder).

## Acceptance criteria

- [ ] Library/Performance: pads behave exactly as before the refactor
- [ ] Editor: A-pad jumps the mix to the cue; B-pad Slides it under the
      playhead; empty-slot set and SHIFT-clear work; release does nothing
- [ ] Mode switches flip pad routing with no reload
- [ ] Dispatch + fake-surface tests: class routed to the audible holder,
      unregistered class silent, claim/release flips routing
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

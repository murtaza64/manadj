# 01 — Gesture-class handle + pads in both modes

Status: ready-for-human

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

## Comments

- 2026-07-05 (edmidi lane): implemented in jj change `qvrpzsqk`. The
  audible-surface handle grew an optional `pads` section (hotCueDown /
  optional hotCueUp / hotCueClear, all deck-addressed); dispatch routes
  hot-cue and hot-cue-clear through `audiblePads()` — unregistered section
  drops, like CUE. Shared surface (DeckContext) delegates to the registered
  deck controls (zero behavior change); the editor registers pads over
  `useHotCueSlots` with the same triggers as DeckCard (A: `player.seek(cue)`,
  B: `slideDeckB('cue', cue)`; set-on-empty at the deck's track playhead;
  SHIFT+pad clears; no release handler — taps). Dispatch tests cover
  routing, drops, claim/release flips. Status → ready-for-human: HARDWARE
  SMOKE TEST — in the editor: A-pad on a set slot restarts the mix at that
  cue; B-pad Slides the cue under the playhead; pad on an empty slot sets a
  cue at that deck's playhead (visible on screen); SHIFT+pad clears; holding
  a pad does nothing extra on release. Library/Performance: pads behave
  exactly as before (set / jump / hold-preview / SHIFT-clear). Switch
  library → editor → library without reload and confirm routing flips.

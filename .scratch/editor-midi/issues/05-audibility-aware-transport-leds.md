# 05 — Audibility-aware transport LEDs

Status: ready-for-agent

## Parent

`.scratch/editor-midi/PRD.md`

## What to build

Stop the transport lights lying while the editor is audible:

- The surface handle exposes a minimal observable transport state (playing,
  per deck; the editor reports its one mix transport for both decks).
- The feedback bridge subscribes to the AUDIBLE holder's transport state
  instead of the shared deck snapshots directly: in the editor, both PLAY
  LEDs are lit while the mix plays and dark when paused; CUE LEDs are dark
  (no editor meaning; pending-blink and away-from-cue flash are shared-
  surface behaviors).
- Pad lights need no change (the editor mirrors its pair onto the shared
  decks, so the hot-cue query already matches) — verify, don't rebuild.

## Acceptance criteria

- [ ] Editor audible: both PLAY LEDs follow the mix transport; CUE LEDs dark
- [ ] Returning to library/performance restores today's LED semantics,
      including pending-blink and CUE behaviors
- [ ] Pad lights stay correct across mode switches
- [ ] ledStates derivation for the audibility switch under vitest
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-gesture-class-handle-pads

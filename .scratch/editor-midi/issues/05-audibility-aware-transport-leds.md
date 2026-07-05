# 05 — Audibility-aware transport LEDs

Status: done

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

## Comments

- 2026-07-05 (edmidi lane): implemented in jj change `uukmzros`. The handle
  grew an optional `transportState` (playing per deck + subscribe); the
  editor reports its one mix transport for both decks. The feedback bridge
  subscribes to the audible holder (resubscribes on claim/release) and,
  while a non-shared holder exposes transport state, feeds ledStates
  through the pure `audibleTransportOverride` — PLAY mirrors the mix, CUE
  dark, pending-blink and cue-flash suppressed (blink clock gated off).
  Pads/PFL pass through (pair mirroring keeps pads true) — verified, not
  rebuilt. Override derivation under vitest at the ledStates seam. Status →
  ready-for-human: HARDWARE SMOKE TEST — editor audible: both PLAY LEDs
  follow mix play/pause; CUE LEDs dark throughout; pad lights match the
  pair. Back in library/performance: PLAY per deck, pending-blink during a
  load with play latched, CUE solid at cue / flashing away-from-cue /
  lit through hold-preview; pad lights still correct after several mode
  switches.
- 2026-07-05 (edmidi lane): hardware smoke tests verified by the user; closed (jj change `owmzxpnt`).

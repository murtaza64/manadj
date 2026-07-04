# 03 — Jog wheels: nudge (playing) + velocity seek (paused)

Status: ready-for-agent

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

- Translator: two's-complement relative tick decoding; jog velocity math.
- Playing Deck: rotation impulses drive the existing bend API (Nudge —
  glossary, widened for impulse-driven bend); a rotation-activity window
  replaces key-up — when ticks stop, bend returns to zero and pitch is
  restored exactly.
- Paused Deck: seek with velocity-sensitive acceleration (slow = beat-level
  precision, hard spin = big travel).
- Touch-top capacitive messages ignored.

## Acceptance criteria

- [ ] Riding the jog on a playing deck bends tempo momentarily and restores
      pitch exactly on release (verify by pitch readout and by ear against
      the other deck)
- [ ] Paused jog: single slow ticks move ~beat-level; hard spins traverse
      minutes; direction correct both ways
- [ ] Touch-top messages: silence
- [ ] Tick decoding + velocity → bend/seek math under vitest (pure,
      message-in/action-out)
- [ ] make typecheck, eslint, vitest green

## Blocked by

- 01-foundation-transport-cue

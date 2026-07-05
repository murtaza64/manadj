# 03 — Jog wheels: nudge (playing) + velocity seek (paused)

Status: ready-for-human (implemented, change plppovrq; checks green — hardware feel-tuning pending)

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

## Comments

- Translator: two's-complement CC tick decode (0x01.. = CW, 0x7f.. = CCW,
  zero = silence); hardware-learned jog CCs are ch 1/2 #9 (mapping change
  xrunwzzz). Touch-top (note #8 / CC #10) left unmapped = ignored.
- midi/jog.ts: pure math (smoothedRate EMA, linear jogBendPercent clamped
  ±8%, quadratic jogSeekDelta capped) + JogController state machine
  (activity-window bend release via setTimeout, mode flip mid-gesture
  releases bend before seeking). Under vitest with a fake port + fake
  timers (jog.test.ts).
- Registrar builds one JogController per deck over engine
  bend/seek/playhead; ready-gated like other controls; disposed on engine
  change.
- Constants (JOG_BEND_PERCENT_PER_TPS, JOG_SEEK_SECONDS_PER_TICK, accel
  knee/cap, JOG_IDLE_MS) are first-guess tunables — expect a feel-tuning
  pass on hardware; shapes are the tested contract.

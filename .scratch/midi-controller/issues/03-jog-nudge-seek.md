# 03 — Jog wheels: nudge (playing) + velocity seek (paused)

Status: done (hardware-verified by Murtaza 2026-07-05)

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
- Bend retuned on Mixxx prior art (change nkqlrnsz): replaced the EMA
  velocity model + 150ms idle cliff with Mixxx's engine nudge model
  (RateControl::getJogFactor + Rotary(25)): ticks accumulate, a 25ms filter
  timer drains them into a 20-slot moving average, bend = avg ×
  JOG_BEND_PERCENT_PER_TICK (10, ≈ Mixxx jogSensitivity 0.1) clamped ±8%.
  Spring-back is inherent — the window empties slot by slot (~0.5s), bend
  lands on exactly 0 and the timer stops. Effective gain is ~10× the old
  guess. setBend is only re-sent on value change. smoothedRate stays for
  paused rim seek acceleration only.

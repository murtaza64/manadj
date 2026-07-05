# 04 — Mixer section: faders, EQ/filter/trim, master, 14-bit pitch, SYNC

Status: done (hardware-verified by Murtaza 2026-07-05)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

- Translator: 7-bit and 14-bit (MSB/LSB pair) absolute value assembly.
- Bindings + handlers: per-channel gain (trim), 3-band EQ, sweep filter,
  channel faders, crossfader, master volume — driving the existing Mixer
  methods. Pitch faders: full ±8% at 14-bit resolution.
- SYNC button: stateless one-shot BPM match (same calculation as on-screen
  MATCH: half/double-time candidates, ±8% clamp).
- Jump semantics everywhere: incoming value applies immediately, no soft
  takeover (PRD decision; soft takeover is a named follow-up).

## Acceptance criteria

- [ ] Every mixer-section control drives its Mixer counterpart across its
      full range; audible smoke test per knob/fader
- [ ] Pitch fader sweeps ±8% smoothly (no 7-bit stepping audible on a
      sustained tone)
- [ ] SYNC matches BPM to the other deck exactly like on-screen MATCH
- [ ] Hardware moves work from any view (known cosmetic gap accepted:
      on-screen mixer knobs don't repaint)
- [ ] 14-bit assembly + value mapping under vitest
- [ ] make typecheck, eslint, vitest green

## Blocked by

- 01-foundation-transport-cue

## Comments

- Translator: 14-bit MSB/LSB assembly emits on the LSB (the MK2 sends
  MSB,LSB pairs per move — hardware-learned, change xrunwzzz); the stored
  MSB persists for LSB-only refinements; an LSB before any MSB drops. 7-bit
  bindings normalize value/127. All under vitest (translator.test.ts).
- Dispatch rescales bipolar targets (pitch ±8%, filter/crossfader -1..1)
  and passes unipolar targets through; jump semantics, no soft takeover.
- MATCH extracted to hooks/useMatchAction.ts — single implementation for
  the on-screen button (keeps its out-of-reach hint) and hardware SYNC
  (silent on out-of-reach: no feedback channel).
- Mixer registers itself into the control registry (MidiMixerControls is
  structurally a subset of Mixer); pitch keeps the on-screen ready gate.
- Pitch fader hardware polarity unverified: mapping assumes MIDI 0 = -8%.
  If the hardware fader is inverted, flip the scaling during the smoke test.

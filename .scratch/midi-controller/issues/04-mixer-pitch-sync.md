# 04 — Mixer section: faders, EQ/filter/trim, master, 14-bit pitch, SYNC

Status: ready-for-agent

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

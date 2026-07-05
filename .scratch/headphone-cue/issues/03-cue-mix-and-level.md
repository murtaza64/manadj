# 03 — Cue/mix blend + cue level

Status: ready-for-agent

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

The beatmatching half of the headphone mix:

- Cue/mix blend: an adjustable taste of master mixed into the Cue bus
  IN THE MAIN GRAPH, before the bridge (ADR 0017 — headphone-internal
  alignment is the point). Screen slider next to the PFL controls,
  cue-heavy default, reset per session. Absolute action target exists for
  future hardware, but this device has no blend control — screen-only.
- Cue level: the Cue bus gain, driven by the hardware headphone-level knob
  (14-bit CC pair 0x04/0x24 on the mixer channel, hardware-learned) and a
  screen control. Jump semantics like every mixer absolute.

## Acceptance criteria

- [ ] Blend slider sweeps headphones from cue-only to full master; beats of
      a matched pair stay aligned in the headphones across the sweep
- [ ] Hardware knob sweeps cue volume smoothly (14-bit); screen control
      repaints from hardware moves
- [ ] Defaults each session: blend cue-heavy, PFL off
- [ ] Blend/gain math + dispatch routing under vitest
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 02-cue-bus-pfl-end-to-end

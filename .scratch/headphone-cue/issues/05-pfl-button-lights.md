# 05 — PFL button lights

Status: ready-for-agent

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

The Controller's PFL buttons light when their channel is cued — Feedback
(glossary), riding the midi-pad-leds output seam:

- PFL LED addresses join the Inpulse Mapping's feedback section
  (Mixxx-sourced, hardware-verified).
- The feedback bridge reads cue state from the Mixer's change subscription
  and drives the lights; correct on connect/replug, dark on release, like
  every other light.

## Acceptance criteria

- [ ] Toggling PFL (screen or hardware) lights/darkens that deck's PFL
      button
- [ ] State correct immediately on connect/replug
- [ ] ledStates coverage for PFL derivation under vitest
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 02-cue-bus-pfl-end-to-end (this feature)
- midi-pad-leds/01-output-seam-play-led (the output seam)

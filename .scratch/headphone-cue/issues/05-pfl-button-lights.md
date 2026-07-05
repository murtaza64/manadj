# 05 — PFL button lights

Status: done

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

## Comments

- (hpcue lane, change srszquvk) Implemented on top of the landed
  midi-pad-leds seam (lane rebased onto main at the issue boundary):
  - `DeckFeedback.pfl: LedAddress` joins the Mapping feedback schema;
    Inpulse addresses: PFL LED echoes its button note 0x0C on the deck
    transport channels (status 0x91/0x92, velocity 0x7f) — consistent with
    how PLAY/CUE echo their inputs and with Mixxx's Inpulse 300 "LED
    Outputs"; covered by the existing TODO(hardware-verify) smoke test.
  - `DeckLedInput.pfl` / `DeckLedStates.pfl` in the pure seam: mirrors
    mixer channel state, phase- and transport-independent (tested);
    `encodeDeckLeds` + `allOffMessages` cover it (dark on release/detach).
  - `MidiFeedbackBridge`'s per-deck publisher reads
    `useMixerValue((m) => m.getChannelState(deck).pfl)` — the same Mixer
    change subscription as the on-screen PFL button, so screen, hardware
    button and light cannot drift; resend-on-outputs-change gives correct
    state on connect/replug for free.
  - 456 vitest green; tsc + eslint clean.
- VERIFIED (hardware, 2026-07-05): PFL LEDs track the cue state from both
  surfaces — the inferred 0x0C LED address is correct on the MK2. Done.
- READY-FOR-HUMAN (change srszquvk): toggle PFL on screen and on the
  hardware — that deck's PFL button lights/darkens both ways; replug the
  controller with a PFL active → light correct immediately; quit/reload →
  dark. Verifies the inferred 0x0C LED address on the MK2.

# 01 — Output seam + PLAY LED end-to-end

Status: done

## Parent

`.scratch/midi-pad-leds/PRD.md`

## What to build

The whole Feedback pipeline, thin: plug in the Controller and each deck's
PLAY LED is solid while that deck plays, off while paused — correct from the
moment of connect, correct after replug, dark when the app lets go.

- Adapter grows output-port support: match output ports by the same
  port-name substring as inputs, publish a per-device send capability
  module-level (mirror of the connection store); send all-off on detach and
  on dispose.
- Mapping schema grows a `feedback` section; the Inpulse file gets PLAY LED
  addresses per deck, sourced from Mixxx's MK2 mapping (cite the source in
  the file; hardware-verify at smoke test).
- Pure seam: deck state in → per-light on/off out; light states + Mapping
  feedback section in → MIDI messages out.
- Headless feedback bridge component (beside the control registrar)
  subscribing to each deck's snapshot, driving the seam, sending.

## Acceptance criteria

- [ ] Connect the device with a deck playing → PLAY LED already solid;
      pause/play flips it live
- [ ] Replug mid-session → LEDs correct without reload
- [ ] Quit/reload the app → lights go dark (all-off on release)
- [ ] Deck A/B lights are independent
- [ ] Works from any view
- [ ] ledStates + message encoding under vitest (synthetic state in →
      asserted messages out; no Web MIDI mocking)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

## Comments

- 2026-07-04 (padleds lane): implemented in jj change `skowtsny`. Adapter
  matches output ports by the same name substring and publishes send
  capabilities to `midi/outputStore.ts` (mirror of connectionStore);
  `midi/feedback.ts` is the tested seam (ledStates + encodeDeckLeds +
  allOffMessages); `MidiFeedbackBridge` (beside the registrar) resyncs the
  full light set per deck on snapshot/output-set changes. All-off on
  detach, on dispose, and on `pagehide` (React cleanups don't run on tab
  close/reload). LED addresses from Mixxx's Inpulse 300 mapping (cited in
  mappings/inpulse300mk2.ts). Status → ready-for-human: HARDWARE SMOKE
  TEST — connect the MK2 with a deck playing (PLAY already solid), flip
  pause/play live, replug mid-session, reload the app (lights must go
  dark), verify A/B independence and any-view operation.
- 2026-07-04 (padleds lane): closed out at the user's direction (jj change
  `vupwxlyw`). Feature landed through main; smoke-test checklist above
  stands as reference if hardware behaves unexpectedly.

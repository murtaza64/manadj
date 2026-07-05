# 02 — Cue bus + PFL end-to-end

Status: ready-for-agent

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

Press PFL (hardware or screen) and hear that channel in the headphones:

- Mixer grows the Cue bus: per-channel PFL taps (post-EQ/filter, pre-fader,
  pre-crossfader), cue sum, cue gain; the summed signal rides issue 01's
  bridge to the cue device. Both channels may be cued at once.
- Action vocabulary + dispatch: PFL toggle button target per channel routed
  to the registered mixer surface; Inpulse binding note 0x0C on the per-deck
  channels (hardware-learned).
- On-screen PFL toggle per deck (performance view), subscribed through the
  Mixer's change subscription so hardware and screen repaint each other.
- Audible-surface arbitration untouched (Cue bus belongs to the shared
  Mixer; the editor's private surface gains nothing).

## Acceptance criteria

- [ ] PFL A/B (screen or hardware) puts that channel in the headphones with
      its fader down and crossfader away, EQ/filter audible
- [ ] Both PFLs on → both decks blended in headphones
- [ ] Screen buttons reflect hardware toggles and vice versa
- [ ] No cue device configured → PFL toggles work (state) but produce no
      sound anywhere; master unaffected
- [ ] Dispatch routing + cue gain math under vitest (prior art: dispatch and
      mixerMath tests)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-sink-bridge-tracer

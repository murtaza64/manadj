# 03 — CUE LED + pending-play blink

Status: ready-for-agent

## Parent

`.scratch/midi-pad-leds/PRD.md`

## What to build

The remaining transport light semantics:

- CUE LED: solid while the deck is paused at the cue point (stab armed), lit
  during hold-to-preview, off otherwise.
- PLAY LED blink while play is latched during a load (pendingPlay): the
  device has no native blink, so one app-driven ~2 Hz timer alternates the
  light, running only while some deck is pending. Solid/off behavior from
  issue 01 unchanged.

## Acceptance criteria

- [ ] Pause at cue → CUE solid; hold-to-preview → CUE lit; playing
      elsewhere → CUE off
- [ ] Latch play during a load → PLAY blinks, then goes solid when playback
      starts (or off if the load fails)
- [ ] No timer runs while nothing is pending
- [ ] Blink phase + CUE derivation under vitest (fed clock, like the jog
      controller tests)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-output-seam-play-led

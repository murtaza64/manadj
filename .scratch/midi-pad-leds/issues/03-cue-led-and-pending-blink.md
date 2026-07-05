# 03 — CUE LED + pending-play blink

Status: ready-for-human

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

## Comments

- 2026-07-04 (padleds lane): implemented in jj change `qwwrzopt`. CUE =
  previewing OR paused-at-cue; at-cue predicate extracted to
  `hooks/useAtCuePoint.ts` and shared with the on-screen CUE button
  (TransportPair). Blink: one clock-derived ~2 Hz timer (feedback.ts
  `blinkPhase`, 250ms half-period), runs only while some deck is
  pendingPlay; both decks blink in step. Status → ready-for-human:
  HARDWARE SMOKE TEST — pause at cue (CUE solid), hold CUE (lit through
  preview), play (CUE off), latch play during a load (PLAY blinks ~2 Hz
  then solid; off if load fails), confirm no blink resends while idle.
- 2026-07-04 (padleds lane, follow-up in jj change `lxxvmsox`): CUE now
  also FLASHES (1 Hz, the on-screen CUE button's away-flash period) while
  paused away from a set cue point — hardware mirrors the screen's third
  CUE state. The blink clock's run condition widened accordingly: it runs
  while some deck is pending-play OR paused away from its cue (so with a
  paused loaded track it is usually running); still one timer, still no
  resends on the deck that isn't blinking. Smoke test addition: pause away
  from the cue → CUE flashes in step with the on-screen button; seek onto
  the cue → solid.

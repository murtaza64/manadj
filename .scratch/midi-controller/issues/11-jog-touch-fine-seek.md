# 11 — Jog touch surface: fine seek when paused

Status: ready-for-human (implemented, change zlqqqsnu; checks green — hardware feel-verify pending)

## Parent

`.scratch/midi-controller/PRD.md` (follow-up to 03-jog-nudge-seek)

## Finding (hardware session)

The jog rim (CC #9) only sends ticks past a rotation-speed threshold —
fine paused seeking is impossible with it. Touching the top surface and
spinning sends CC #10 at a much higher message rate (the touch note #8
stays unmapped). Learned in the 01 session: deck A/B touch-spin = cc ch 1/2
#0x0A.

## What to build

- New relative target `jog-touch` bound to CC #10 per deck.
- Paused deck: touch-spin seeks FINELY — linear seconds-per-tick, no
  velocity acceleration (predictability beats reach; hard travel is the
  rim's job).
- Playing deck: touch-spin is ignored — there is no scratch model, and the
  dense tick stream would swamp the rim's bend velocity math.
- Rim behavior unchanged (bend when playing, accelerated seek when paused).

## Acceptance criteria

- [ ] Touch+spin on a paused deck seeks smoothly at beat-placement
      precision, both directions
- [ ] Touch+spin on a playing deck does nothing (no bend wobble)
- [ ] Rim nudge/seek behave exactly as before
- [ ] Touch seek math + routing under vitest
- [ ] make typecheck, eslint on touched files, vitest green

## Comments

- Landed in change zlqqqsnu — note its description reads "midi-pad-leds +
  headphone-cue: grill (docs)": a concurrent grill session in the same
  workspace described the working-copy change and its CONTEXT.md glossary
  edits (Feedback entry, Controller/Mapping wording) rode along. The change
  contains BOTH that docs work and this issue's full implementation
  (jog-touch target, mapping CC #0x0A bindings, JogController.onTouchTicks,
  registry/dispatch/registrar wiring, tests). Gate was green on the merged
  content. Immutable now; recorded here instead of rewritten.
- Touch seek is linear (JOG_TOUCH_SEEK_SECONDS_PER_TICK = 0.01 s/tick) —
  tune on hardware.
- Release continuation (change xskqnktl): letting go of a spinning platter
  hands ticks from CC #10 back to CC #9; rim ticks continuing a touch
  gesture now keep the fine seconds-per-tick until the wheel stops
  (JOG_FINE_CONTINUATION_MS window, extended by each continuation tick).
  While the touch stream is live, rim ticks are dropped
  (JOG_TOUCH_AUTHORITATIVE_MS) so dual streams can't double-seek. If the
  two CCs tick at different densities per revolution, the handoff may still
  feel like a speed step — tune the constants on hardware.

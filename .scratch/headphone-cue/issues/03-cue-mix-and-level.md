# 03 — Cue/mix blend + cue level

Status: ready-for-human

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

## Comments

- (hpcue lane, change rwtxtkux) Implemented:
  - Blend in the MAIN graph, before the bridge (ADR 0017): new `program`
    sum node (post-crossfader, PRE master volume — the master fader never
    changes headphone loudness); `cueSum → cueMixCueGain` +
    `program → cueMixMasterGain` → `cueGain` (level) → cue limiter →
    bridge. `mixerMath.cueMixGains` is equal-power (cos/sin: constant
    energy across the sweep, both signals present at center) — tested for
    endpoints/equal-power/monotonicity/clamping.
  - `Mixer.getCueMix/setCueMix` (0 = cue only, 1 = master only), session
    default `CUE_MIX_DEFAULT = 0.25` (cue-heavy, PRD); cue level default
    `CUE_LEVEL_DEFAULT = 0.7` (from issue 02); both exported for UI resets,
    both reset per session like all mixer state.
  - Actions: `AbsoluteTarget` += `cue-level`, `cue-mix`; dispatch passes the
    normalized 0..1 through to `setCueLevel`/`setCueMix` (jump semantics);
    `MidiMixerControls` grew both.
  - Inpulse mapping: headphone-level knob = 14-bit CC 0x04/0x24 on the mixer
    channel (ch 0) → cue-level (hardware-learned). No cue/mix control on
    this device — screen-only, target bindable for other devices.
  - Screen: CUE MIX + PHONES HFaders in the mixer strip's left cell,
    subscribed via useMixerValue (hardware knob repaints PHONES live);
    double-click resets to the session defaults.
  - 428 vitest green; tsc + eslint clean.
- READY-FOR-HUMAN (change rwtxtkux): with a matched pair cued/playing,
  sweep CUE MIX end to end — headphones go cue-only → master-only with
  beats staying locked across the sweep; sweep the hardware headphone knob
  — smooth (14-bit) volume, PHONES fader tracks it; reload the app — PFL
  off, CUE MIX back to cue-heavy.

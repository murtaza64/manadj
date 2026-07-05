# 09 — Hardware moves repaint the on-screen mixer controls

Status: ready-for-human (implemented, change znpowyzt; checks green — eye-verify with hardware pending)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

Close issue 04's accepted cosmetic gap: fader and knob moves on the
Controller don't repaint the Performance-mode controls (knobs/faders hold
local positions seeded once from the Mixer's getters).

- Make the Mixer observable: setters notify subscribers (mixer state stays
  module state, ADR 0009 — React just subscribes).
- `useMixerValue(selector)` hook via useSyncExternalStore.
- TRIM/EQ/FLT knobs, VOL fader, X-FADER and MASTER become controlled
  components reading the Mixer directly — pointer, wheel, keyboard, and
  hardware all repaint everything.

## Acceptance criteria

- [ ] Moving any hardware mixer control repaints its on-screen counterpart
      live, in every view that shows it
- [ ] On-screen interaction (drag/wheel/double-click reset) behaves as
      before
- [ ] Two windows/views seeded from the same Mixer stay consistent after
      hardware moves (no stale local positions)
- [ ] make typecheck, eslint on touched files, vitest green

## Blocked by

None (rides the landed midi-controller stack).

## Comments

- Pitch already repainted (it reads the deck snapshot); this issue is the
  Mixer-backed controls only.
- Mixer.subscribe/notify is untestable without stubbing AudioContext
  (setters build the graph); left as hands-on-verified glue per house
  style, like the rest of ADR 0009's audio path.

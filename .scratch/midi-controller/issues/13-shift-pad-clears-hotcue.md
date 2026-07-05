# 13 — SHIFT+pad clears the hot cue

Status: ready-for-human (implemented, change qstrpums; checks green — hardware smoke test pending)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

The standard DJ convention: holding SHIFT and pressing a hot cue pad deletes
that slot's hot cue — the hardware counterpart of the on-screen pads' remove
action.

- Action vocabulary grows a hot-cue-clear button target (deck + pad).
- Mapping: the shifted pad layer is hardware-learned (SHIFT is
  hardware-layered; shifted pads emit notes 0x08–0x0F on the hot cue
  channels, e.g. deck A shifted pad 1 = note 0x08 ch 6) — bind all 16.
- Dispatch routes the down edge to the registered deck controls; the
  registrar wires it to the same remove path the on-screen pads use (React
  Query curation — screen and pad lights stay consistent).
- Clearing an empty slot is a silent no-op.

## Acceptance criteria

- [ ] SHIFT+pad on a set slot deletes the hot cue; on-screen pad empties
- [ ] SHIFT+pad on an empty slot: silence, no crash
- [ ] Un-shifted pad behavior unchanged (set/jump/hold-preview)
- [ ] With midi-pad-leds landed: the pad light goes dark after the clear
- [ ] Dispatch routing under vitest (prior art: hot-cue tests in the
      dispatch suite)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- Coordination only: change 12 (gentle-rim-shift-fast-seek) is in flight in
  the midi lane and touches the same dispatch/registry/mapping files — land
  after it.

## Comments

- hot-cue-clear button target added to the vocabulary; dispatch routes the
  down edge to the registered deck controls; registrar wires it to the same
  React Query remove path as the on-screen pads, so screen state and the
  padleds lights follow a hardware clear automatically.
- Mapping: 16 shifted-pad bindings via a shiftedPadClears helper (notes
  0x08-0x0F on the HOTCUE channels). Deck A shifted pad 1 is
  hardware-learned; the other 15 carry TODO(hardware-verify).
- Empty-slot clear is a silent no-op (remove() checks the slot).

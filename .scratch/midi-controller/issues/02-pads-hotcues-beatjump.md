# 02 — Pads: hot cues + shifted beatjump mode

Status: ready-for-human (implemented, change zyzmqnov; checks green — hardware smoke test pending)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

Pads 1–8 in Hot Cue mode trigger the Deck's Hot Cues (existing
set/jump/hold-to-preview down/up semantics). One shifted mode: beatjump
back/forward and size halve/double. Translator gains named-modifier
(SHIFT) layers — schema supports both hardware-shifted messages and
software-tracked SHIFT; whichever the device does is established
empirically and recorded in the mapping. All other pad modes stay
unmapped.

## Acceptance criteria

- [ ] Hot cue pads: set on empty slot when appropriate, jump/hold-preview
      on filled — identical to on-screen pads
- [ ] Shift layer: beatjump ◀/▶ and size halve/double work; sizes match
      the on-screen readout
- [ ] Sampler/slicer/FX/loop pad modes: silence
- [ ] Translator modifier-layer logic under vitest (both shift styles)
- [ ] make typecheck, eslint, vitest green

## Blocked by

- 01-foundation-transport-cue

## Comments

- Hardware learn (change xrunwzzz) settled the SHIFT question: the MK2 is
  hardware-layered — shifted controls emit distinct messages (e.g. hot cue 1
  shifted = note ch 6 #8 vs #0) and SHIFT sends its own note. Translator
  modifier layers are therefore unnecessary; the `modifier` schema field
  stays unused.
- Beatjump back/forward bound to the learned IN/OUT-style buttons
  (notes ch 1/2 #9/#0A), not a shifted pad mode (PRD deviation, deliberate:
  the hardware has dedicated buttons; pads stay hot-cue-only).
- Beatjump size halve/double bound to the jump buttons' SHIFT layer
  (shifted = channel+3; deck A halve is hardware-learned, the other three
  carry TODO(hardware-verify) for the smoke test).
- New seam: `midi/controlRegistry.ts` (module-level, mirrors audibleSurface)
  + headless `MidiControlRegistrar` registering hot-cue/beatjump handlers
  from the same hooks the on-screen pads use. Tested at dispatch+registry
  (dispatch.test.ts); registrar is glue per house style.

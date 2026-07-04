# 02 — Pads: hot cues + shifted beatjump mode

Status: ready-for-agent

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

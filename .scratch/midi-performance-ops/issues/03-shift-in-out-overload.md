# SHIFT+IN/OUT: loop resize while looping, beatjump-size when idle

Status: ready-for-human

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

State-disambiguated overload of the SHIFT layer of the IN/OUT buttons (already bound to beatjump-size halve/double): while the deck has an active loop, they mean loop resize halve/double; with no loop, they keep meaning beatjump-size, exactly as today. IN/OUT unshifted stay beatjump back/forward — untouched.

This implements the MIDI half of `.scratch/looping/issues/07-overload-jump-and-loop-controls.md` (annotated 2026-07-05); the on-screen overload remains open there.

## Acceptance criteria

- [ ] With a loop active, SHIFT+IN halves and SHIFT+OUT doubles the running loop (existing resize semantics)
- [ ] With no loop, SHIFT+IN/OUT change beatjump size exactly as before
- [ ] Unshifted IN/OUT beatjump behavior unchanged
- [ ] Tests assert both states of the disambiguation, per deck

## Blocked by

None - can start immediately

## Comments

- 2026-07-06 (midiops lane, change `mxokvwlw`): implemented. New `loop-or-jump-size` vocabulary target; SHIFT+IN/OUT bindings (ch 4/5 notes 0x09/0x0a) rebound from `beatjump-size` to it (`beatjump-size` stays in the vocabulary, now unbound on this device). Dispatch asks the audible surface's loops section `resizeActiveLoop(deck, change)` (consumed-boolean); no loop — or a surface without loops — falls back registry-direct to `beatjumpSize`, unchanged. Disambiguation predicate lives in `DeckEngine.resizeActiveLoop` (tested seam). Unshifted IN/OUT untouched (pinned by mapping test). Both states tested per deck.
- Review note (spec-review flag): the three-way case "editor audible + a loop still set on a silenced shared deck + SHIFT+IN/OUT" resolves to beatjump-size (the loops class is unregistered there, so no loop is visible to dispatch; beatjump-size is registry-direct per ADR 0019). The specs never decided this case — flagging for a human call; trivially changeable to a drop if preferred.

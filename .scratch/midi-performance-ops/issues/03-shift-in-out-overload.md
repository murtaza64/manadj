# SHIFT+IN/OUT: loop resize while looping, beatjump-size when idle

Status: ready-for-agent

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

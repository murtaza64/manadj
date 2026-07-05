# Jump events in the Transition model, editor, and playback

Status: ready-for-agent

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

Extend the Transition model with **Jump events**: playback discontinuities of the incoming Track at a mix instant (glossary; ADR 0020). Incoming-Track-only — the Sketch origin invariant (outgoing track time ≡ mix time) is untouched. The incoming deck's arrangement math becomes piecewise across jumps; the editor renders Jump events on the timeline and lets the user add, move, and delete them; MixPlayer performs the seek at the jump instant so a doubled buildup plays back as performed. Jump events persist inside the Transition's existing opaque data payload (no schema migration) and survive the usual save/load round trip. Templates do NOT carry jumps (out of scope per PRD).

This is a prefactor slice for capture: the vectorizer (issue 04) will emit Jump events into this support.

## Acceptance criteria

- [ ] A Transition can carry zero or more Jump events on the incoming Track (mix instant → new incoming track position)
- [ ] Arrangement math for the incoming Track is piecewise across Jump events; pure-model tests cover it alongside the existing slide/crop/chop suites
- [ ] Editor playback audibly executes the jump (demo: add a jump that repeats the incoming Track's buildup, hear it doubled)
- [ ] Jump events are visible on the editor timeline and can be added, repositioned, and deleted
- [ ] Jump events persist with the Transition and survive reload (existing client-authoritative pair-replace path, ADR 0011)
- [ ] Transition templates ignore Jump events (deriving a template from a Transition with jumps drops them)

## Blocked by

None - can start immediately

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

## Comments

**Done** (jj change `ppuxyvmx`, lane `takes01`, 2026-07-05). All acceptance criteria met:

- `JumpEvent { x, deltaSec }` on `Transition.jumps` (incoming-only); `bTrackTimeAt` piecewise, `bEndMixTime` segment walk (first end is the end; a jump firing exactly as B's tape runs out wins — matches delta-at-instant semantics), `arrangementAt` jump-aware. Crop remaps (`cropRemapJumps`/`Left`) keep absolute time; cut-off jumps drop (an instant has nothing to pin). All under vitest.
- MixPlayer: jump-crossing detection per tick + one hard deck sync per crossing (drift corrector alone would miss sub-tolerance deltas).
- Editor: dashed cyan markers with Δ chips (whole-B-beats label when a grid fits, else seconds); drag moves the instant (A-grid snap, shift = fine); click opens Δ editor (seconds input, ±1/±4 B-beat steppers, delete); double-click on row B inside the window adds one. Marker indices are insertion-stable across x drags.
- Persistence flows through the opaque `data` payload untouched (save + reload round-trip tested); a jump materializes a pristine Transition (lazy-persistence rule extended).
- Templates carry no jumps (no model field; stamping onto a jump-carrying Transition targets a fresh take — regression-tested).

Known v1 approximation, deliberate: B's waveform keeps its base (no-jump) alignment mapping on the timeline — post-jump on-screen content is approximate; audio (arrangementAt) is authoritative. Splitting B's drawn block at jump instants is follow-up material if it bothers in practice.

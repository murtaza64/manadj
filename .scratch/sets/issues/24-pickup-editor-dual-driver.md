# 24 — Pickup during an editor audition creates dual deck drivers (choppy Deck B)

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## Problem (diagnosed 2026-07-05, live incident)

Symptom: in the Transition editor, Deck B audibly rubber-bands — few-ms
jumps, "speeding up/slowing down repeatedly". Performance mode clean;
tempo match irrelevant; appears after having used Set playback; cleared
by hard refresh; not casually reproducible.

Root cause — three facts that compose:

1. The Pickup predicate checks deck/mixer state only — it never consults
   the audible-surface holder. Editor auditions play Set tracks audibly
   through the shared decks, so the Pickup control LIGHTS during an
   editor audition (the Set pane sits under the editor).
2. `Conductor.pickup()` activates with `silencePrevious: false` (by
   design — adopt the live state), so the displaced holder is never
   silenced.
3. The Transition editor has no displacement stand-down: unlike the
   Conductor (whose `subscribeAudible` hook stands it down when another
   claimant takes the holder), a displaced-without-silence MixPlayer
   keeps its rAF loop conducting.

Result: two conductors drive the shared decks. Pickup's anchor-deck
contract (anchor untouched) concentrates the fight on the NON-anchor
deck — hence B-only wobble: Conductor enforces plan position + pickup
pitch ramp; MixPlayer enforces its arrangement; B gets alternating
seeks and rate writes.

Repro: Play set → stop → open the editor on a pair that is in the Set →
play the audition → press Pick up in the Set pane below → B wobbles.

## What to build

Two fixes — the semantic one and the invariant one; do both:

1. **Pickup refuses non-performance holders.** The predicate is unlit
   (with reason, per the Pickup glossary entry's reason-teaches-the-fix
   pattern: e.g. "editor is auditioning") whenever the audible-surface
   holder is not the shared performance surface. You cannot "pick up
   from" an editor audition — its deck state is mix-timeline semantics,
   not a live performance.
2. **The editor stands down on displacement.** TransitionEditor
   subscribes to holder changes (exactly like the Conductor's own
   stand-down hook) and pauses its MixPlayer when another surface takes
   the holder. This restores the invariant for ALL future claimants:
   at most one driver conducts the shared decks, ever, regardless of
   silencePrevious semantics.

## Acceptance criteria

- [ ] Pickup control unlit during editor auditions, with a displayed reason
- [ ] A displaced editor's MixPlayer pauses (no rAF driving after holder change)
- [ ] Regression test at the arbiter seam: editor claims + plays, conductor
      pickup attempted → either refused or editor demonstrably stops
      conducting; the fake decks receive commands from at most one driver
      (harness prior art: `mixPlayerSteadyState.investigation.test.ts` on
      the chopb lane, change syonswzu — fake engines with action logs)
- [ ] Ear check on the repro recipe above: no B wobble

## Notes

- `Conductor.ts` / pickup territory is lane `setlist`'s (issues 21/22 in
  flight there) — route this to that lane; coordinate before touching.
- The investigation harness (chopb lane) also established MixPlayer's
  steady-state is clean and pure clock skew is too slow to explain the
  symptom — worth folding the zero-corrective-actions assertion into the
  editor's test suite while in there.

## Blocked by

- Coordination only: lane setlist's in-flight 21/22 (same files)

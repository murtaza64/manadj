# 26 — Unresolved adjacencies auto-resolve; explicit Hard-cut pin

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (decided 2026-07-05; CONTEXT.md Unresolved + Hard-cut pin + Set playback updated)

## What to build

Model revision: an **Unresolved adjacency resolves at plan time** to the pair's best saved Transition — **favorite first, else the most recently edited** — and hard-cuts only when the pair has no Transitions. Unresolved is deliberately library-live: saving or favoriting a Transition upgrades every unresolved adjacency for that pair, everywhere, immediately (with 24, even mid-playback). Pinning freezes; a new explicit **Hard-cut pin** kind forces a cut even when Transitions exist.

- Resolution lives in the shared adjacency-view / plan-input layer so the ladder, badges, list rows, Conductor, and practice affordance all agree.
- Pin picker gains "hard cut" as a selectable option alongside the pair's Transitions and Takes.
- Persistence: new pin kind on the Set entry (client-authoritative like the rest); no change to Transition/Take pin semantics; Dormant-pin machinery treats a Hard-cut pin like any pin (dormancy round-trips it).
- Badges: the red hard-cut chip (20's styling) appears only when a cut will actually play — no evidence, or explicit Hard-cut pin; an auto-resolved adjacency shows the resolved Transition's chip with a subtle "auto" mark distinguishing it from a pinned one. UNPRACTICED unchanged.
- Auto-fill's role shrinks to what it still adds: bulk-pinning (freezing) auto-resolved choices; the entry rule for actual cuts stays 19's (Hot Cue 1 → start).
- Take pins are untouched: Takes never auto-resolve (unreviewed by definition).

## Acceptance criteria

- [ ] Unresolved adjacency with saved Transitions plays the favorite (else most recently edited) — in the plan, the ladder, and audibly
- [ ] Saving a new Transition for such a pair upgrades the adjacency without any user act (and live, once 24 lands)
- [ ] Hard-cut pin selectable in the picker; forces a cut despite available Transitions; survives dormancy round-trips
- [ ] Red hard-cut chip only on actually-cutting adjacencies; auto-resolved chips visually distinct from pinned ones
- [ ] Pinned adjacencies (Transition/Take) behave exactly as before — resolution never overrides a pin
- [ ] Resolution logic pure + tested at the adjacency/planner seam

## Notes

- Sequencing: touches `SetDetailPane` rows/badges (rows bundle 23/18/20 in flight on setui) and plan-input assembly (25 in flight on setlist) — dispatch after both park/land. Natural home: whichever lane frees first, with the other's landing rebased over.
- Softened invariant, recorded deliberately: unpinned playback may change as the library evolves — the original grill's determinism concern is now scoped to *pinned* adjacencies only (product-owner decision 2026-07-05).

## Blocked by

- Soft: rows bundle (23/18/20) and 25 in flight

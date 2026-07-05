# 08 — Tier headers: reify candidate strength in the results list

Status: ready-for-agent

## Parent

.scratch/follow-mode/PRD.md (out-of-scope item promoted after eye-verify)

## What to build

While Follow is filtering, the track table groups candidates under full-width section headers naming their tier, with counts. Headers render only while following; manual browsing stays a flat table. Empty tiers get no header.

Tier order (provisional, still model-internal), reflecting the linked-pairs PRD's Known ranking (favorited Transition > Linked > unfavorited Transition):

| # | Header |
|---|---|
| 0 | ★ Favorited transition |
| 1 | 🔗 Linked |
| 2 | ◆ Saved transition |
| 3 | Same key |
| 4 | Relative key |
| 5 | Key up |
| 6 | Key down |
| 7 | Other matches |

- The old proven tier (0) splits by `PairInfo.preferred`; the Linked group reads the landed linkStore (read-only) for grouping.
- Dual follow: headers name the relationship class, not the reference (best tier wins, as before); the row's key column disambiguates.
- User's sort still orders within each group.

**Coordination (linkedpairs lane, their issue 04):** grouping-only here — Links do NOT yet OR into the candidate set, and "proven only" keeps its name; both are linked-pairs 04, which should rebase onto this tier renumbering. A linked track appears under 🔗 only if it is already a candidate via heuristics/Transitions.

**Design rider:** the ★ mark renders smaller than the ◆ diamond at equal font-size — scale the star up ~30% in the row marks and the Transition editor's favorite control.

## Acceptance criteria

- [ ] Following: candidates grouped under tier headers with counts; empty tiers absent; not following: no headers
- [ ] ★/◆ split by favorited; linked-and-unfavorited-transition pairs group under 🔗 (best evidence wins)
- [ ] Selection, keyboard navigation, double-click Load, and row marks unaffected by header rows
- [ ] Model tests: new tier numbering incl. Linked, label mapping
- [ ] ★ ~30% bigger in row marks and editor favorite control
- [ ] Gate green

## Blocked by

None - can start immediately

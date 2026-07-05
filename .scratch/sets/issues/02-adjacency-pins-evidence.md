# 02 — Adjacency pins, evidence, badges

Status: done (landed on main, change ooytvuot)

## Parent

.scratch/sets/PRD.md

## What to build

Adjacency rows between Set tracks, carrying the pin model: each adjacency pins a saved Transition (by uuid), a Take (by uuid), or nothing (Unresolved). Pin columns on the Set entry, persisted client-authoritatively. UI: pin state per adjacency; auto-fill proposes Transitions only (favorite first, else sole Transition) — one click to accept, per-adjacency or set-wide; manual pin picker lists the pair's Transitions and Takes (Takes are never auto-filled — always a manual act). Badges: **Unresolved** (nothing pinned — "will hard-cut") and **Unpracticed** (ordered pair has no saved Transition and no Take) are orthogonal and rendered distinctly. Evidence counts per adjacency (N transitions · M takes).

Write the ADR "Set adjacencies may pin unpromoted Takes" (contradicts the prior "Takes are audit data" stance; alternatives were auto-promote-on-pin and snapshotting vectorized data — see PRD).

## Acceptance criteria

- [ ] Pins persist and round-trip; saving new Transitions for a pair never changes an existing pin
- [ ] Auto-fill offers favorites first and never proposes a Take
- [ ] A Take can be pinned manually; unresolved and take-pinned states render distinctly
- [ ] Unpracticed badge appears exactly when the ordered pair has zero Transitions and zero Takes
- [ ] Evidence counts match the Transition library / Take history for the pair
- [ ] ADR committed under docs/adr/

## Blocked by

- 01-set-model-sidebar-crud

## Comments

**2026-07-05 — Done (change ooytvuot, landed on main).** Migration
`0020_ooytvuot` adds nullable `pin_kind`/`pin_uuid` to set_entries (pin =
the adjacency the entry HEADS; stored as asserted, no FK — dangling
degrades client-side). Schemas validate kind∈{transition,take} and
kind/uuid travel together; router persists pins through the wholesale
replace (tests extended). Frontend: `sets/adjacency.ts` pure model
(autoFillProposal: favorite first, else sole Transition, never a Take;
adjacencyView: pin resolution w/ dangling→unresolved, orthogonal
Unresolved/Unpracticed, evidence counts) under `adjacency.test.ts`;
`SetDetailPane` grew adjacency rows between track rows — pin chip
(◆ transition / ● take / ✕ hard cut), per-adjacency one-click accept +
header set-wide Auto-fill (fills only pin-less adjacencies), manual pin
picker (ContextMenu) listing the pair's Transitions AND Takes + Unpin,
UNRESOLVED and UNPRACTICED badges rendered distinctly, `N tr · M tk`
counts from the pair store / takes history. ADR
`docs/adr/0023-set-adjacencies-may-pin-unpromoted-takes.md` written.
Promotion re-pointing of Take pins is issue 03+ scope (per PRD hook).

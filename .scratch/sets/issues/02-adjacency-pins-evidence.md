# 02 — Adjacency pins, evidence, badges

Status: ready-for-agent

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

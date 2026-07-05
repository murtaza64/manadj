# 07 — Reorder live preview + Dormant pins

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Non-destructive reordering. A pin whose adjacency is broken by reorder/removal becomes a **Dormant pin**: a per-Set, per-ordered-pair memory (persisted with the Set), restored automatically when that pair becomes adjacent again in that Set — including manually-pinned Takes (the original manual act is honored). Strictly per-Set: other Sets get ordinary auto-fill. There is no discard warning — nothing is destroyed.

During a drag, the overview ladder recomputes optimistically for the hypothetical order, rendering each affected adjacency's future distinctly: will-restore (Dormant pin exists), auto-fillable (library Transition exists), unresolved. Drop commits; cancel restores.

## Acceptance criteria

- [ ] Reordering away and back restores the exact prior pins (Transitions and Takes)
- [ ] Dormant pins persist across reloads and never leak to other Sets
- [ ] Drag preview updates the ladder live with the three adjacency futures distinguished
- [ ] Cancelled drag leaves Set and ladder untouched
- [ ] Planner/store tests cover dormancy round-trips

## Blocked by

- 03-planner-overview-ladder

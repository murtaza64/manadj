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

## Comments

**2026-07-05 — obligations from issues 08 + 12 (lane setpins).** Dormant
pins don't exist yet, so three lifecycle behaviors were deferred here:

1. **Drop Dormant pins referencing deleted artifacts** (12's deferred
   criterion): wire Dormant storage into `degrade_pins`
   (`backend/routers/sets.py`), which currently nulls only active
   set_entries pins on Take delete / Transition pair-replace delete.
2. **Re-point Dormant Take pins at promotion** (08): the rewrite in
   `set_promoted` (`backend/routers/takes.py`) — and its client mirror
   `repointTakePinsLocal` in `setStore.ts` — cover only active pins;
   Dormant storage must join both.
3. **Reconcile with `insertTrackIntoSet`** (`setStore.ts`, from issue
   10): insert leaves the predecessor's pin on its entry (rides along,
   degrades to an unresolved display for the new pair). Under Dormant
   semantics that pin should presumably become a Dormant pin for the
   original ordered pair instead of squatting on the new adjacency.

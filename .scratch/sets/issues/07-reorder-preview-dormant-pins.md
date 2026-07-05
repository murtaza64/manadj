# 07 — Reorder live preview + Dormant pins

Status: done

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

**2026-07-05 — implemented (lane setui, change `mwzqllkt`); parked
ready-for-human.** All acceptance criteria + the three obligations above.

- Pure rule: `frontend/src/sets/dormancy.ts` — `reconcileOrderChange`
  (every order change routes through it: reorder/insert/remove/append;
  broken pins go Dormant per ordered pair, newly-adjacent pairs restore)
  and `previewAdjacencyFutures` (will-restore / auto-fillable /
  unresolved). Exported for issue 18's multi-row blocks.
- Store: `dormantBySet` in `setStore.ts`, pushed wholesale with entries
  (ADR 0011); explicit pin (single + set-wide auto-fill) retires the
  pair's memory; load normalizes self-inconsistent server state;
  `repointTakePinsLocal`/`degradeDeletedPinsLocal` cover memories.
- Backend: `set_dormant_pins` table (migration `0022_mwzqllkt`),
  wholesale replace in PUT /entries + GET; `degrade_pins` DROPS
  memories of deleted artifacts (obligation 1); `set_promoted`
  re-points Dormant Take pins (obligation 2).
- Preview: in-pane row drag recomputes the ladder for the hypothetical
  order (planner untouched — read-only dependency); dashed violet ↺
  frame = will-restore, dashed yellow ◆ blade = auto-fillable, red ✕ =
  unresolved. Drop commits, cancel (Esc/leave) snaps back.
- Verification: `uv run -m pytest` 663 passed; `npx vitest run` 1010
  passed; frontend build clean; `alembic heads` = `0022_mwzqllkt` only.

**Verification walkthrough** (lane app on ports 8140/5313):
open http://localhost:5313 →
1. Select a Set with 3+ tracks; pin two adjacencies (pin chip → pick a
   Transition/Take).
2. Drag a pinned row elsewhere — while dragging, the ladder shows the
   hypothetical order: broken pairs' futures render as dashed yellow ◆
   (library Transition exists) or red ✕ (nothing); pairs whose Dormant
   memory would wake show a dashed violet ↺ frame.
3. Press Esc mid-drag — Set list and ladder snap back untouched.
4. Drop, then drag the row back to its original slot — while dragging
   you see violet ↺ on the original pairs; drop: the exact prior pins
   are back (chips + green/orange bands), no dialog anywhere.
5. Reload the page after step 4's intermediate state (reorder away,
   reload): the Dormant state survived — dragging back still restores.
6. Open a second Set sharing the same tracks: its adjacencies are
   unaffected (dormancy is strictly per-Set).

**2026-07-05 — approved and landed** (`mwzqllkt`, re-gated after 16
landed first: pytest 666, vitest 1041, single alembic head). Follow-up
filed: 20-list-drag-preview (extend the drag preview from the ladder to
the track list itself).

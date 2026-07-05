# 23 — List drag preview (rows + adjacency rows)

(Renumbered from 20, 2026-07-05 — parallel filing collided with 20-set-row-polish.)

Status: ready-for-human

## Parent

.scratch/sets/PRD.md

## What to build

Extend 07's live drag preview from the overview ladder to the track
list itself. During an in-pane row drag, the list renders the
HYPOTHETICAL state — the same `reconcileOrderChange` /
`previewAdjacencyFutures` output the ladder already consumes
(`frontend/src/sets/dormancy.ts`):

- Rows display in the hypothetical order (sortable-list behavior — the
  dragged row visibly slots into its target position).
- Adjacency rows recompute for the hypothetical pairs: a restored pin
  shows its normal chip plus a will-restore marker (violet ↺, the 07
  vocabulary); newly-formed pairs show their future via the existing
  `adjacencyView`/badge machinery (auto-fillable / will hard-cut).
- Drop commits `previewOrder` directly (preview ≡ commit by
  construction); cancel (Esc/leave/dragend) snaps the list back.
- The blue drop-indicator line becomes redundant for in-pane drags (the
  moved row IS the indicator) but stays for library/playlist drags,
  which cannot preview (drag payload unreadable during dragover — ids
  only ride `dragIdsRef` for in-pane drags).

## Implementation notes (from the 07 session's design discussion)

- `handleDragOver` computes the insertion index from displayed row
  rects; once rows display the hypothetical order, interpret the index
  against that displayed order (standard sortable pattern). Steady
  state is stable — pointer over the dragged row's own slot reproduces
  the same order — but midline flips near the tall adjacency rows may
  jitter; needs a real-mouse feel check.
- The drag source element must stay mounted for `dragend` to fire;
  React keys rows by trackId, so reordering preserves the element.
- Row affordances (practice, menus, ▶/✕) are inert mid-drag — no
  interaction conflicts expected.
- Cheaper fallback if full row motion feels bad: rows stay put, the
  breaking adjacencies dim with a "pin → Dormant" chip, and the
  indicator line grows labels for the pair(s) it would create.

## Acceptance criteria

- [ ] In-pane drag reorders the visible rows live; adjacency rows show
      the hypothetical pins/futures (will-restore marker included)
- [ ] Drop commits exactly what was previewed; Esc/leave restores the
      committed list untouched
- [ ] Library/playlist drags keep today's indicator-line behavior
- [ ] Ladder and list previews stay consistent (same reconcile output)
- [ ] No dragover feedback loops/jitter (feel-checked with a mouse)

## Blocked by

- 07-reorder-preview-dormant-pins (landed `mwzqllkt`)

## Comments

**2026-07-05 — filed from the 07 session.** Interplay with issue 18
(row selection + group drag): 18 reworks row dragging for multi-row
blocks and is ready-for-agent. Whichever lands first, the other adapts —
`applyReorder` and `reconcileOrderChange` already take id lists, so the
sortable preview generalizes to blocks for free; 18's `dragIdsRef`
becomes the selection instead of a single id. Coordinate via the lane
registry if picked up concurrently.

**2026-07-06 — implemented (lane setui, change `pykptyny`); parked
ready-for-human.** All acceptance criteria except the real-mouse feel
check (criterion 5 — a human act by definition; walkthrough below).

- The row stack renders `displayEntries`/`displayPlan` — the same
  `reconcileOrderChange` output the ladder consumes — so mid-drag the
  list IS the hypothetical state: rows in hypothetical order (dragged
  row dimmed, sortable-style), restored pins showing their normal chip
  plus a violet "↺ will restore" marker, newly-formed pairs flowing
  through the existing `adjacencyView` machinery (proposal button /
  UNRESOLVED badge). `WILL_RESTORE_COLOR` extracted to dormancy.ts —
  ladder frames and list markers share the one constant.
- `handleDragOver` interprets the insertion index against the DISPLAYED
  order (standard sortable pattern); steady state is a fixed point
  (unit-tested in dropIndex.test.ts). In-pane drags suppress the blue
  indicator line (the moved row is the indicator); library/playlist
  drags keep it and never preview.
- Drop commits `previewOrder` directly (preview ≡ commit); a null
  preview means the order never left committed — no-op. Esc/leave/
  dragend snap back (existing 07 paths, unchanged).
- The conducting highlight now follows the trackId, not the entry index
  — mid-preview the committed plan's index points at the wrong row.
- Verification: frontend build clean; vitest 1042 passed; pytest 666;
  `alembic heads` = `0022_mwzqllkt` only; eslint clean on touched files
  (one pre-existing warning).

**Verification walkthrough** (lane app on ports 8140/5313):
open http://localhost:5313 →
1. Select the demo Set ("07 review — dormant pins", 3+ tracks, pins).
2. Drag a row slowly up/down the list: rows re-slot live under the
   pointer (the dragged row rides along, dimmed); the blue indicator
   line never appears for this drag.
3. Watch the adjacency rows mid-drag: broken pairs' replacements show
   the auto-fill proposal button or the red UNRESOLVED badge; a pair
   whose Dormant pin would wake shows its restored pin chip plus the
   violet "↺ will restore" marker. The ladder above shows the same
   futures (◆ / ✕ / ↺) — list and ladder never disagree.
4. FEEL CHECK (the open criterion): hover the midlines near the tall
   adjacency rows and hold the pointer still over the dragged row's own
   slot — no jitter/flicker of the row order.
5. Drop — the committed list is exactly what was previewed. Esc mid-drag
   (or drag out of the pane) — the list and ladder snap back untouched.
6. Drag a track in from the Library/a playlist: today's blue indicator
   line behavior, no row motion.

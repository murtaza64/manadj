# 23 — List drag preview (rows + adjacency rows)

(Renumbered from 20, 2026-07-05 — parallel filing collided with 20-set-row-polish.)

Status: ready-for-agent

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

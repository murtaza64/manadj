# 18 — Set view: row selection + group drag-reorder

Status: needs-triage

## Parent

.scratch/sets/PRD.md

## What to build

The Set detail view has no row selection: `SetTrackRow` always drags
`[trackId]` alone. Dragging a *group* of tracks to reorder a set is a
natural act (split out of the 17 grill, 2026-07-05).

Half the machinery exists: the drag payload format carries id arrays,
and `SetDetailPane.handleDrop`'s reorder path already calls
`applyReorder(orderIds, droppedIds, …)` with plural dropped ids. What's
missing is the selection model and its interaction design:

- Click / shift-click / cmd-click selection coexisting with drag-start,
  the hover ▶/✕, and the conducting-row highlight
- Group drag = the selected rows move as a contiguous block to the drop
  point (define: do non-contiguous selections compact?)
- **Pin semantics + ladder preview are the real meat**: a moved
  contiguous block keeps its internal pins; only the edge adjacencies
  break/degrade. This is issue 07's territory (Dormant pins, live drag
  preview) — coordinate: implement against 07's dormancy rules if 07
  has landed, or hand 07 the group-edge cases if not.

Free rider: issue 17's context menu upgrades to multi automatically
(its targeting rule already prefers the selection; the shared menu core
is multi-aware).

## Acceptance criteria

- [ ] Rows are selectable (single, range, toggle) without breaking
      drag-reorder, hover affordances, or the conducting highlight
- [ ] Dragging a selected row moves the whole selection; internal pins
      of a contiguous block survive the move
- [ ] Edge adjacencies degrade per the pin rules (07's dormancy if
      landed; hard degradation otherwise) and the drag preview shows it
- [ ] Right-click with a selection: issue 17's menu acts on the
      selection

## Blocked by

- 17-set-row-context-menu (targeting rule + multi-aware menu core)
- Coordinate with 07-reorder-preview-dormant-pins (edge-pin semantics)

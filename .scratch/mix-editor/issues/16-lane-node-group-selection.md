# 16 — Lane editor: node group selection and dragging

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md` (Editor tools). Prototype iteration.

## What to build

Multi-select and group-move for breakpoints within a single automation lane:

- **Rubber-band select**: cmd/ctrl+drag over a lane draws a selection rect;
  nodes inside become selected (rendered distinctly, e.g. filled ring).
  Plain drag keeps its current meaning (move nearest node / draw); shift
  stays with the chop stamp.
- **Toggle select**: cmd/ctrl+click a node adds/removes it.
- **Group drag**: dragging any selected node moves the whole selection by
  the same delta (x and y), clamped to the lane bounds; relative spacing
  preserved; no reordering past unselected neighbors (clamp at collision).
- **Deselect**: Esc or plain click on empty lane space.
- **Delete**: Delete/Backspace removes selected nodes (endpoints follow the
  existing endpoint rules).
- Per-lane selection only (v1). Cross-lane group time-shift is the known
  v2 — don't preclude it (selection state keyed by lane id).

## Acceptance criteria

- [ ] Rubber-band, toggle, group drag, deselect, delete all work as above
- [ ] Group drag preserves shape exactly (deltas, not per-node re-snapping);
      clamping degrades gracefully at bounds
- [ ] Existing gestures unchanged: click-add, single-node drag, dblclick
      remove, shift chop stamp
- [ ] Selection visuals readable against lane fill and waveforms
- [ ] Pure lane-model logic (group move/clamp/delete) under vitest
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately. Coordinate with issue 04 (chop stamp) and
issue 05 (endpoint rendering) if in flight — same LaneCanvas code.

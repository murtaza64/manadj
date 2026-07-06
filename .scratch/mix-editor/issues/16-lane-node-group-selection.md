# 16 — Lane editor: node group selection and dragging

Status: ready-for-human (implemented, change rlrspylz on lane lanesel —
eye-verify: cmd/ctrl+drag rubber-band, cmd/ctrl+click toggle, group drag
clamping at neighbors/bounds, Esc/click-away deselect, Delete/Backspace,
and that click-add / single drag / dblclick remove / shift chop still feel
unchanged)

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

## Comments

- 2026-07-06 (lane lanesel, change rlrspylz): implemented. Pure logic in
  `frontend/src/editor/laneSelection.ts` (indicesInRect / toggleIndex /
  moveGroup / deleteSelected) under vitest (18 tests); gestures wired in
  LaneCanvas; selection state lives in DawTimeline keyed by lane id
  (`{ lane, indices }` — v2 cross-lane widens it to a map), cleared on
  transition switch and on structural point changes (chop stamp, dblclick
  remove, out-of-range guard). Behavior decisions: plain click on empty
  space with an active selection deselects INSTEAD of adding (click again
  to add); group drag anchors the grabbed node (beat magnet applies to the
  pointer, one shared delta moves the group — never per-node re-snapping);
  Delete keeps the lane's ≥1-point invariant (all-selected keeps the first
  node). NOTES.md is an archive post-graduation — no entry (this comment is
  the iteration record). tsc, eslint, vitest 1131, build all green.

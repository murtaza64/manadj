# Multi-select in track tables

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

Multi-selection in all track tables, everywhere a `TrackList` renders:

- Shift-click selects a range; cmd-click toggles membership; plain click
  selects one.
- The last-clicked Track is the **anchor**: Enter/double-click loads the
  anchor to the Deck (unchanged single-track semantics); arrow keys move
  from the anchor and collapse the selection back to single.
- Cmd-A selects all rows in the table.
- Selection state lives in a pure, framework-free module with operations
  for click/shift-click/cmd-click/arrow/select-all, holding the ordered
  selection + anchor. The table renders from it.
- Row drag payload carries the full selection (in selection order) when
  the dragged row is part of it; existing drag-to-sidebar appends all
  selected Tracks.

## Acceptance criteria

- [ ] Range, toggle, and single selection work in every track table (library, playlist, performance-view browse)
- [ ] Enter/double-click loads the anchor; Load-blocking rules on playing Decks unchanged
- [ ] Arrows collapse to single selection from the anchor; Cmd-A selects all
- [ ] Dragging a selected row drags the whole selection; drag-to-sidebar appends all (duplicates handled by the API no-op)
- [ ] Selection model covered by vitest unit tests (playback/editor-store test pattern): anchor rules, range across sort changes, toggle, collapse, select-all

## Blocked by

None - can start immediately

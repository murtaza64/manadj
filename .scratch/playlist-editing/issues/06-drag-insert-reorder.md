# Drag insert and reorder with drop indicator

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

Positional drag-and-drop for Playlist curation, in the split edit view:

- **Library pane → Playlist pane**: dragging the selection over the
  Playlist pane shows an insertion-line indicator between rows; dropping
  inserts the Tracks at that position in selection order. Dropping in the
  empty area below the last row appends. Already-present Tracks are
  skipped (API no-op) with a toast reporting the skipped count.
- **Reorder within the Playlist pane**: same gesture and indicator moves
  the selected rows to a new position. Available **only when the table is
  sorted by `#`** — under any other sort, in-pane drag-reorder is
  disabled (Play order is never rewritten by a view sort, per glossary).
- Drop-index math (insertion point from pointer position, append zone)
  lives in a pure module shared with sidebar reordering (08).
- Persistence via the positioned-insert and typed reorder endpoints; the
  `#` column reflects the new Play order immediately.

## Acceptance criteria

- [ ] Insertion line tracks the pointer between rows; below-last-row drop appends
- [ ] Cross-pane drop inserts multi-selection in selection order at the indicated position
- [ ] Duplicate Tracks in a drop are skipped with a count toast
- [ ] In-pane reorder works under `#` sort and is unavailable under other sorts
- [ ] Drop-index math unit-tested with vitest (insertion index, append zone, multi-row drag offsets)

## Blocked by

- `.scratch/playlist-editing/issues/02-multi-select-track-tables.md`
- `.scratch/playlist-editing/issues/05-split-edit-view.md`

## Comments

Done (jj xszrmnzx). Pure drop-index math in selection/dropIndex.ts
(insertionIndexFromPointer midline rule, indicatorY, applyReorder with
pre-removal index adjustment, splitByMembership; 12 vitest cases). The
playlist pane hosts the insertion line (content-coordinate math, scrolls
with rows). Drop branching is membership-based: all-present payload =
in-pane reorder (full permutation POST; refused with a toast under
non-# sorts); payload with new tracks = positioned sequential inserts in
selection order (append under non-# sorts), present ones skipped with a
count toast. reorderTracks client now throws on non-ok so stale
permutations surface (toast + refetch). Also: view/playlist switches now
clear the main selection, preventing the keep-anchor splice from leaking
a foreign track into the playlist pane's reorder math.

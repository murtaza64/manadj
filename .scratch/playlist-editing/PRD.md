# PRD: Playlist Editing

Status: ready-for-agent

## Problem Statement

Playlists in manadj are defined in the glossary as hand-curated, *ordered*
lists of Tracks — and the backend fully supports that (position column,
reorder/remove endpoints, client methods). But none of it is reachable:
the UI can create a Playlist, drag single tracks onto a sidebar row to
append, and delete a Playlist via an `×` button. There is no way to
reorder tracks, remove a track from a Playlist, see Play order, rename a
Playlist, set its color, or reorder the sidebar. Curating a set — the core
of what a Playlist is for — cannot actually be done.

## Solution

Make Playlists editable end-to-end:

- A **Play order** (`#`) column in playlist views. Sorting by other
  columns is view-only and never rewrites Play order; drag-reordering is
  available only when sorted by `#` (the default).
- An **edit toggle** on the playlist view that splits it into two stacked
  panes: the Playlist (in Play order) on top, the full library with its
  FilterBar below. Drag tracks from the library pane into position, or
  reorder within the Playlist pane, with a drop-indicator line.
- **Multi-select** in all track tables (shift-click range, cmd-click
  toggle) so add/remove/drag operate on sets of Tracks.
- **Context menus**: on track rows (Load to Deck A/B, Add to playlist ▸,
  Remove from playlist) and on sidebar Playlist rows (Rename, Change
  color ▸, Delete).
- **Duplicate prevention**: a Track appears at most once per Playlist,
  enforced by the schema; adding a present Track is a no-op with a toast.
- **Sidebar drag-reordering** of Playlists.

## User Stories

1. As a DJ, I want a `#` column showing each Track's Play order in a Playlist, so that I can read the set's flow at a glance.
2. As a DJ, I want playlist views to open sorted by Play order, so that the set reads in the order it will be played.
3. As a DJ, I want to sort a Playlist's table by BPM, key, or any other column without changing its Play order, so that I can inspect the set (e.g. eyeball the energy curve) non-destructively.
4. As a DJ, I want to drag tracks to a new position within a Playlist when viewing in Play order, so that I can rearrange my set.
5. As a DJ, I want drag-reordering to be unavailable when the table is sorted by another column, so that I can't accidentally rewrite Play order while merely inspecting.
6. As a DJ, I want an edit toggle on the playlist view that opens the library as a second pane below the Playlist, so that I can build the set without losing sight of it.
7. As a DJ, I want the library pane in edit mode to have the full FilterBar, so that I can filter/search for candidate Tracks while editing.
8. As a DJ, I want to drag Tracks from the library pane into a specific position in the Playlist pane, indicated by an insertion line, so that new Tracks land exactly where the set needs them.
9. As a DJ, I want dropping Tracks in the empty area below the last row to append them, so that quick adds don't require precise aim.
10. As a DJ, I want to select multiple Tracks with shift-click (range) and cmd-click (toggle) in any track table, so that I can operate on several Tracks at once.
11. As a DJ, I want the last-clicked Track to act as the selection anchor — Enter/double-click loads it, arrow keys move from it and collapse the selection — so that multi-select doesn't change familiar Deck-loading behavior.
12. As a DJ, I want to drag a multi-selection into a Playlist and have the Tracks inserted in selection order, so that bulk adds preserve my intent.
13. As a DJ, I want a Track to appear at most once per Playlist, so that accidental double-drops don't corrupt my set.
14. As a DJ, I want adding an already-present Track to be a no-op with a subtle toast, so that I'm informed without being interrupted.
15. As a DJ, I want multi-drags that include already-present Tracks to insert only the new ones and toast the skipped count, so that bulk adds are forgiving.
16. As a DJ, I want a right-click context menu on any track row with "Load to Deck A" and "Load to Deck B", so that I can load Decks without double-click ambiguity.
17. As a DJ, I want "Add to playlist ▸" with a submenu of my Playlists on the track context menu, so that I can add Tracks (including multi-selections) without dragging across the screen.
18. As a DJ, I want "Remove from playlist" on the track context menu when viewing a Playlist, so that I can prune a set.
19. As a DJ, I want Delete/Backspace to remove the selected Tracks when the Playlist pane is focused, so that pruning is fast — and without a confirmation, since re-adding is cheap.
20. As a DJ, I want "Load to Deck" menu items disabled when multiple Tracks are selected, so that an ambiguous action is impossible rather than surprising.
21. As a DJ, I want click to focus a pane in the split view (with a visible cue) and keyboard input to apply to the focused pane, so that arrows/Enter/Delete/Cmd-A act where I expect.
22. As a DJ, I want Tab to switch focus between the two panes, so that I can edit without reaching for the mouse.
23. As a DJ, I want Cmd-A to select all Tracks in the focused pane, so that bulk operations are quick.
24. As a DJ, I want a right-click context menu on sidebar Playlist rows with Rename, Change color, and Delete, so that Playlist management is in one place.
25. As a DJ, I want to rename a Playlist inline from that menu, so that fixing a name is immediate.
26. As a DJ, I want to change a Playlist's color from that menu, so that the sidebar color-coding I already see is actually settable.
27. As a DJ, I want Playlist deletion to ask for confirmation, so that hand-curated sets aren't lost to a misclick.
28. As a DJ, I want the sidebar `×` delete buttons removed once the menu exists, so that misclicks near a Playlist row can't destroy it.
29. As a DJ, I want to drag sidebar Playlist rows to reorder them, so that my most-used sets sit where I want them.
30. As a DJ, I want dragging a Playlist row to show an insertion line between rows, while dragging Tracks over the sidebar highlights the target row, so that the two drag meanings are visually distinct.
31. As a DJ, I want the existing drag-track-to-sidebar-row gesture to keep working (appending), so that quick adds from any view don't require edit mode.
32. As a DJ, I want browsing a Playlist without the edit toggle to look exactly like today (full-height table), so that reading and loading from a set is uncompromised.

## Implementation Decisions

- **Entry identity**: a Playlist entry is identified by `(playlist, track)`.
  A unique constraint on that pair is added via an Alembic migration that
  first deduplicates existing rows (keeping the lowest position, compacting
  positions). Backward compatibility is a non-concern.
- **API keying**: the remove-track and reorder endpoints key on `track_id`
  instead of the playlist-track row id; the internal row id is never
  exposed to the frontend. The reorder payload becomes a typed list of
  `(track_id, position)` pairs rather than untyped dicts.
- **Duplicate add**: adding a present Track returns success with an
  indicator that it was skipped (idempotent no-op), so bulk adds can
  report a skipped count. Positioned insert (existing capability) is used
  for drop-at-position.
- **Play order column**: `#` joins the column config like other columns
  (resizable, toggleable) but appears only in playlist tables and is the
  default sort there. Column sorting anywhere remains a pure view concern.
- **Selection model**: a pure frontend module (framework-free) holding the
  ordered selection + anchor, with operations for click/shift-click/
  cmd-click/arrow/select-all. Track tables render from it; Deck-loading
  (Enter/double-click) targets the anchor.
- **Context-menu infrastructure**: one generic context-menu component
  (positioning, dismiss, submenus, disabled items) used by both the track
  row and sidebar menus. The existing narrow `onContextMenu` uses (hot
  cues, deck cards) are untouched.
- **Split view**: an edit toggle on the playlist view; stacked layout —
  Playlist pane (Play order) on top, library pane with FilterBar below.
  Focus model: click focuses; Tab toggles; keyboard shortcuts route to the
  focused pane. Non-edit playlist browsing is unchanged.
- **Drop indicator**: shared insertion-line logic (pure drop-index math
  from pointer position) used by playlist-pane drops, in-pane reorders,
  and sidebar Playlist reordering. Sidebar drop handling branches on drag
  payload: playlist drag → insertion line; track drag → row highlight
  (append).
- **Toasts**: no notification system exists; a minimal transient notice
  component is introduced for the duplicate-skip messages.
- **Playlist management**: Rename (inline edit in the sidebar row),
  Change color (small palette submenu writing the existing color field),
  Delete (confirmation kept). The `×` button is removed.
- **Sidebar reordering**: drag rows; persists via the existing
  display-order plumbing.

## Testing Decisions

- Good tests exercise external behavior at module interfaces, not
  implementation details (ADR 0002). No mocking library; real in-memory
  SQLite.
- **Backend seam — playlists router via FastAPI TestClient** (pattern:
  the acquisition router tests): dedupe migration semantics via the
  constraint, duplicate add as no-op with skip indicator, positioned
  insert and position compaction, track_id-keyed remove, typed reorder
  including rejection of malformed payloads. This is the first test
  coverage playlist CRUD gets.
- **Frontend seam — pure logic modules via vitest** (pattern: the
  playback and editor store tests): the selection model (anchor rules,
  range/toggle/collapse/select-all) and drop-index math (insertion point
  from pointer position, append zone, payload branching). No DOM/component
  tests, matching the codebase.

## Out of Scope

- **Hide track (soft deletion)** — filed separately as its own effort;
  the track context menu is its future surface.
- Duplicate playlist, playlist Export actions in menus (Export lives in
  the Sync view), "Find Compatible" from the context menu.
- Filtering/searching within the Playlist pane itself.
- Playback queue / auto-advance from a Playlist; seeding a Mix from a
  Playlist (deferred with the Mix concept).
- Playlist folders/nesting (manadj Playlists stay flat; hierarchy is an
  Export-boundary concern).

## Further Notes

- Glossary updated during design: **Play order** added; **Playlist**
  sharpened to "a Track appears at most once".
- The backend CRUD (positioned insert, remove with compaction, bulk
  reorder, playlist display-order reorder) and frontend API client
  methods already exist; most backend work is the identity/keying change,
  most frontend work is net-new UI.

## Comments

Code review 2026-07-04 (two-axis, vs 7dc6d2f4). Fixed in
`playlist-editing: review fixes`: ArrowUp/Down navigate alongside j/k
(story 11 / issue 05 AC); drop branching is now SOURCE-based (a track
drag carries its origin pane — fully-present drops from the library pane
are no-op + toast instead of silently reordering); playlist deletion only
ejects to All tracks when the deleted playlist was the one being viewed;
legacy 'trackId' drag payload removed (AGENTS.md: no backward compat).

Accepted deviations: rename also commits on blur (standard UX, spec said
Enter/Escape); playlist header strip exists in non-edit view (hosts the
Edit toggle — "pixel-equivalent" read as intent, not literal); '#'
"toggleable" is vacuous (no column-visibility UI exists for any column);
non-# sort drags still show an append indicator, refusal happens at drop.
Noted for future refactors (not blocking): rect/indicator DnD duplication
between Library and PlaylistSidebar; Library.tsx size (divergent change);
clampToViewport tested in trackDrag.test.ts.

# Play order column + remove from playlist

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

Make Play order visible and Playlists prunable, in the existing (non-split)
playlist view:

- A `#` column showing Play order (1-based display of position), present
  only in playlist tables. Joins the column config like other columns
  (resizable, toggleable). Default sort in playlist views is `#`
  ascending; sorting by any other column is view-only and never rewrites
  Play order.
- **Remove from playlist** on the track-row context menu (playlist views
  only), acting on the selection — no confirmation (re-adding is cheap).
- **Delete/Backspace** removes the selected Tracks when a playlist table
  has focus.
- Removal uses the track_id-keyed endpoint; positions compact server-side
  and the view refreshes in Play order.

## Acceptance criteria

- [ ] `#` column renders only in playlist tables and is the default sort there
- [ ] Sorting by other columns never mutates Play order (verify via API state after sorting)
- [ ] Context-menu Remove and Delete/Backspace both remove the full selection, no confirm
- [ ] Positions remain contiguous after removal (server compaction reflected in `#`)
- [ ] Router tests already cover remove/compaction (01); this slice is demoable end-to-end in the UI

## Blocked by

- `.scratch/playlist-editing/issues/01-playlist-entry-identity.md`
- `.scratch/playlist-editing/issues/02-multi-select-track-tables.md`
- `.scratch/playlist-editing/issues/03-context-menu-infra-track-row.md`

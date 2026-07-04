# Playlist sidebar context menu: rename, color, delete

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

Playlist management via a right-click context menu on sidebar Playlist
rows (reusing the menu infrastructure from 03):

- **Rename** — inline edit in the sidebar row (reuse/adapt the existing
  inline-create input pattern); Enter commits, Escape cancels.
- **Change color ▸** — submenu with a small palette (bright, fully
  saturated colors per project preference) writing the existing Playlist
  color field; the sidebar row border reflects it immediately.
- **Delete** — keeps a confirmation (destructive of curation), then
  deletes the Playlist. The current `×` button on sidebar rows is
  removed; the menu is the only delete path.

The menu applies only to real Playlist rows, not the "All tracks" /
"Unprocessed" pseudo-views.

## Acceptance criteria

- [ ] Right-click on a Playlist row opens the menu; pseudo-views have no menu
- [ ] Rename inline with commit/cancel; name persists
- [ ] Color picked from submenu persists and renders in the sidebar
- [ ] Delete confirms, then removes the Playlist (entries cascade); viewing the deleted Playlist falls back to All tracks
- [ ] `×` buttons gone

## Blocked by

- `.scratch/playlist-editing/issues/03-context-menu-infra-track-row.md`

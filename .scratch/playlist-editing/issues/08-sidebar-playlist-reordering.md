# Sidebar playlist drag-reordering

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

Drag sidebar Playlist rows to reorder them, persisting via the existing
display-order plumbing (endpoint and client method already exist,
unused).

- Playlist rows become draggable; dragging shows the shared
  insertion-line indicator between rows (drop-index math from 06).
- Drop handling branches on drag payload: dragging a **Playlist** shows
  the insertion line and reorders; dragging **Tracks** keeps today's
  behavior — the target row highlights and the drop appends. The two
  must not interfere.
- Pseudo-views ("All tracks", "Unprocessed") are neither draggable nor
  valid Playlist-drop positions above them.
- New order persists and is reflected everywhere Playlists are listed in
  sidebar order (including the Add to playlist ▸ submenu).

## Acceptance criteria

- [ ] Playlist rows drag-reorder with insertion-line feedback; order persists across reload
- [ ] Track drags onto sidebar rows still highlight-and-append; payload branching has no cross-talk
- [ ] Pseudo-views unaffected by reordering
- [ ] Add to playlist ▸ submenu reflects the new order

## Blocked by

- `.scratch/playlist-editing/issues/06-drag-insert-reorder.md` (shared drop-indicator/drop-index module)

## Comments

Done (jj rmppuqry). Sidebar playlist rows draggable (payload MIME
'application/x-manadj-playlist' in selection/playlistDrag.ts, distinct
from track drags). List container branches on payload: playlist drag →
shared insertion-line indicator (dropIndex math) and full-order POST to
/playlists/reorder; track drag → row highlight (new visual) + append, as
before. Rows aren't draggable mid-rename; pseudo-views sit outside the
list container and are unaffected. Add to playlist ▸ reflects the new
order automatically (same ['playlists'] query).

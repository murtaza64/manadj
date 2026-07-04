# Split edit view: toggle, stacked panes, focus model

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

The playlist-editing split view:

- An **edit toggle** on the playlist view. Off (default): the playlist
  fills the view exactly as today. On: two stacked panes — the Playlist
  (in Play order, with `#` column and remove behaviors from 04) on top,
  the full library with its FilterBar below.
- **Focus model**: click (or any selection) in a pane focuses it; a
  subtle visual cue marks the focused pane; Tab switches pane focus.
  Keyboard input routes to the focused pane: arrows/Enter (anchor
  load), Cmd-A (select all in pane), Delete/Backspace (remove — playlist
  pane only; no-op in the library pane).
- Library-pane behavior is the ordinary library table: filters, sorting,
  context menu, load to Deck.
- No drag between panes yet (06); adds from the library pane work via
  the context menu's Add to playlist ▸.

## Acceptance criteria

- [ ] Toggle on/off; non-edit browsing pixel-equivalent to today
- [ ] Stacked layout: Playlist top, library + FilterBar bottom; both panes fully functional track tables
- [ ] Focus follows click, visible cue, Tab toggles focus
- [ ] Arrows/Enter/Cmd-A/Delete route to the focused pane; Delete inert in the library pane
- [ ] Selecting a different Playlist or leaving the playlist view exits edit mode cleanly

## Blocked by

- `.scratch/playlist-editing/issues/04-play-order-column-remove-track.md`

## Comments

Done (jj mvumnxuu). Edit toggle in a slim playlist header strip (name +
count + Edit/Done); split stacks playlist pane (Play order, # column,
remove behaviors) over FilterBar + library pane. Selection machinery
extracted to selection/useTrackSelection.ts (one instance per pane;
anchor keep-visible only on the main pane). Focus: mousedown-capture on
panes, blue outline cue, Tab switches (new hub prop); j/k, Cmd-A, Enter,
t/e route to the focused pane's selection; Delete only fires with the
playlist pane focused. Context menu is pane-aware (Remove only on
playlist-pane rows). All-tracks query enabled while editing; edit mode
exits on playlist/view switch. Runtime-smoked against the sandbox clone
on port 8040 (list, get, duplicate-add skip).

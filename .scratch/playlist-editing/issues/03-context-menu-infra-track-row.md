# Context-menu infrastructure + track-row menu

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

A generic context-menu component (positioning within viewport, dismiss on
click-away/Escape, submenu support, disabled items) and the first menu
using it — right-click on any track row:

- **Load to Deck A** / **Load to Deck B** — disabled when more than one
  Track is selected; respects existing Load rules (blocked on a playing
  Deck in the Performance view).
- **Add to playlist ▸** — submenu listing all Playlists (sidebar order);
  choosing one appends the selection. Already-present Tracks are skipped
  via the API no-op; a toast reports skips ("2 already in playlist").
  Introduce the minimal transient toast/notice component here (none
  exists).
- Right-clicking a row not in the current selection selects it first
  (standard behavior), so the menu always acts on the visible selection.

Existing narrow `onContextMenu` uses (hot cues, deck cards) are untouched.

## Acceptance criteria

- [ ] Reusable menu component: viewport-aware positioning, submenus, disabled state, Escape/click-away dismiss
- [ ] Track-row menu works in every track table; Load items disabled for multi-selections
- [ ] Add to playlist appends selection in selection order; duplicate skips reported via toast
- [ ] Right-click outside the selection re-selects to the clicked row
- [ ] Toast component exists and is reusable

## Blocked by

None - can start immediately (multi-selection behaviors degrade gracefully to single selection until 02 lands)

## Comments

Done (jj uyzltozy). Generic ContextMenu component (viewport clamp, hover
submenus with edge flip, disabled/danger/separator items, Escape and
click-away dismiss) + ToastProvider (bottom-center transient notices,
mounted app-wide in App.tsx, additive). Track-row menu in Library: Load to
Deck A/B (disabled for multi-selections, routed through the embedding
view's load policy when present), Add to playlist ▸ (sidebar-ordered
submenu, appends the selection, duplicate skips toasted). Right-click
outside the selection re-selects the clicked row. Unit tests for
clampToViewport and the drag payload helpers.

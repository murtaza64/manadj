# 01 — Set model, sidebar siblings, CRUD

Status: done (landed on main, change mtwlsrnp)

## Parent

.scratch/sets/PRD.md

## What to build

The Set artifact end-to-end, without pins: schema (a Set with name/order metadata; ordered entries, a Track at most once per Set), Alembic migration, backend router, API client resource, and UI. Sets appear in the sidebar as siblings of Playlists (own section, own colors, "+ new set"). Selecting a Set swaps the browse surface's main pane to a Set detail view: ordered track rows (title/artist, key, BPM), add tracks from the library browse, remove, drag-reorder, rename, delete. Persistence follows the client-authoritative pattern established for Transitions (ADR 0011): the client owns Set state and replaces it wholesale.

Set-view state (selected Set, scroll position) lives in a store, not component state — every top-panel mode mounts its own browse instance, and the PRD requires the Set pane to survive mode switches unmoved.

## Acceptance criteria

- [ ] Migration adds Set + Set-entry tables; `uv run alembic heads` shows one head
- [ ] Router tests (in the mold of the takes router tests) cover CRUD + wholesale replace + at-most-once enforcement
- [ ] Sidebar shows a Sets section under Playlists; create/rename/delete work
- [ ] Set detail pane: add/remove/drag-reorder tracks, order persists across reload
- [ ] Switching top-panel modes and returning does not lose the selected Set or scroll position
- [ ] Deleting a Set touches no Track/Transition/Take

## Blocked by

None - can start immediately

## Comments

**2026-07-05 — Done (change mtwlsrnp, landed on main).** Migration
`0019_mtwlsrnp` (sets + set_entries, unique (set_id, track_id));
`backend/routers/sets.py` (CRUD + wholesale entries replace reconciled by
track_id, per ADR 0011) with `tests/test_sets_router.py` in the takes-router
mold; `api.sets` resource appended to `api/client.ts`; new
`frontend/src/sets/` — `setStore.ts` (module store: selected Set + scroll +
client-authoritative entries, followStore/pairStore patterns),
`SetsSidebarSection.tsx` (section under Playlists: create/rename/recolor/
delete, drop-to-add), `SetDetailPane.tsx` (ordered rows w/ key+BPM,
drag-reorder, remove, drop-to-add). Library/PlaylistSidebar touched
additively; `ViewType` gained `'set'`; track context menu gained
"Add to set ▸". Set view + scroll survive mode switches via the store.

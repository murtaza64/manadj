# 01 — Set model, sidebar siblings, CRUD

Status: ready-for-agent

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

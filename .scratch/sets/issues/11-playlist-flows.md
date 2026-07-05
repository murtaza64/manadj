# 11 — Playlist flows

Status: done

## Parent

.scratch/sets/PRD.md

## What to build

The two Playlist↔Set conveniences, both one-time copies (no live link): **New Set from Playlist** — copy the Playlist's Play order into a new Set, offering auto-fill for every adjacency with library Transitions; **Create Playlist from Set** — copy the Set's track order into a new ordinary Playlist (the escape hatch to Export; Sets themselves never Export).

## Acceptance criteria

- [ ] Set created from a Playlist preserves order; auto-fill offer covers eligible adjacencies
- [ ] Playlist created from a Set preserves order and Exports like any Playlist
- [ ] Neither direction creates a live link — later edits on either side don't propagate

## Blocked by

- 01-set-model-sidebar-crud

## Comments

**2026-07-05 — implemented (lane setsugg, change nwxymvpq, stacked on 10's tlrnwnvp), ready for human review.**

What was built:

- `frontend/src/sets/playlistFlows.ts` — both one-time copies over existing APIs, no backend changes, no migration:
  - `createSetFromPlaylist`: Playlist's Play order → new Set (same name/color), entries unpinned — the Set view's existing auto-fill offers (header button + per-adjacency `↳ pin`) cover every adjacency with library Transitions.
  - `createPlaylistFromSet`: Set's track order → new ordinary Playlist (sequential appends preserve order; pins not copied — no playlist meaning). Exports like any Playlist; Sets themselves never Export.
- Menu items (appended): playlist row → "New set from playlist" (selects the new Set); set row → "Create playlist from set" (toast).
- `playlistFlows.test.ts`: order preservation, name/color propagation, unpinned copy — API mocked at the client seam.

**Verification walkthrough** (lane app running):

- Open http://localhost:5283 (or `npm --prefix desktop start -- --port 5283`)
- Right-click a playlist (e.g. "dnb set 1") → **New set from playlist**: a Set with the same name/color appears in the Sets section and opens, tracks in Play order; adjacencies with library Transitions show auto-fill offers; Auto-fill (N) in the header where proposals exist.
- Right-click the Set "Suggest demo" → **Create playlist from set**: toast; the new playlist holds tracks 9, 549, 171 in that order and behaves like any playlist (Export path unchanged).
- No live link: reorder/remove a track in the source after copying — the copy does not change (and vice versa).

Gate (on the stacked tree): pytest 633 ✓, vitest 792 ✓ (3 new), build ✓, eslint clean on touched files, alembic single head ✓. Stack parked for review: `tlrnwnvp` (10) → `nwxymvpq` (11); approving both lands the head, approving only 10 lands the prefix.

**2026-07-05 — approved and landed.** Human click-through approved; stack rebased onto trunk, re-gated (pytest 633, vitest 792, build, single alembic head), landed as `tlrnwnvp` + `nwxymvpq`.

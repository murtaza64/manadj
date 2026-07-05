# 17 — Set view: track-row context menu (+ shared track menu module)

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Track rows in the Set detail view have no context menu — the only row
operation is the hover ✕. Motivating case (12's review): an archived
row shows "⚑ archived", and the natural next acts (remove from set,
unarchive) should be a right-click away.

Grilled 2026-07-05. Two parts:

### 1. Shared universal track menu module

Operations that always make sense on a track, regardless of surface,
live in one module (new universal operations get one home later):

- **Pure core**: `trackMenuItems(input): MenuItem[]` — input carries
  the target tracks (1..n), playlists list, sets list,
  `excludeSetId?` / `excludePlaylistId?` (the current container never
  lists itself), optional `loadToDeck` callback (absent ⇒ no Load
  items), and action callbacks.
- **Thin hook**: `useTrackMenuItems(opts)` wraps the core with the
  playlists/sets queries, add-to-playlist / add-to-set actions with
  toasts, and archive/unarchive mutations carrying the full
  invalidation set (`['tracks']`, `['playlist']`, `['sets']`) plus the
  playlist-membership confirm flow.
- Universal items, stable order: Load to Deck A / B · Add to
  playlist ▸ · Add to set ▸ · Archive|Unarchive.
- **Archive↔Unarchive is per-track** (`archived_at`), replacing
  Library's view-level switch; a mixed multi-selection shows both,
  each acting on its subset.
- Callers append surface-specific items: Remove from set (Set view),
  Remove from playlist (Library playlist view) — danger-styled.

### 2. Callers

- **SetDetailPane**: right-click on a SetTrackRow opens the menu.
  Single-row de facto (no selection model — see issue 18), but bake in
  Library's targeting rule from day one: targets = the selection if
  the clicked row is in it, else the clicked row. Load policy is one
  prop: Library.tsx:919 mounts the pane and already owns
  `loadWithViewPolicy` — pass it down, so embedded views (editor
  assign-to-pair, Performance lock) keep their semantics.
  No archived-row menu emphasis: the ⚑ mark is the pointer, the menu
  is the act; stable order beats state-dependent reordering.
- **Library.tsx migrates in this issue** (`rowMenuItems`, ~line 685) —
  one caller doesn't prove a seam, and duplicate archive mutations are
  the drift class 12 just patched. Parity to preserve: multi-select
  labels ("Add 3 to playlist"), Load disabled on multi, the
  playlist-membership confirm before archive, Archived view keeping
  Load/Add for auditioning. Also retires the exhaustive-deps
  eslint-disable on the old memo.

## Acceptance criteria

- [ ] Right-click on a Set track row opens the menu: Load A/B, Add to
      playlist ▸, Add to set ▸ (current set excluded), Remove from set,
      Archive|Unarchive per the row's `archived_at`
- [ ] An archived row's menu offers Unarchive and Remove from set
- [ ] Load in the Set view routes through the embedding view's load
      policy
- [ ] Library's row menu behavior is unchanged post-migration (parity
      list above) and archive/unarchive from either surface refreshes
      the Set flag (`['sets']` invalidation)
- [ ] Left-click/drag paths (reorder, hover ▶/✕) unchanged
- [ ] Pure-core vitest suite: per-track archive swap incl. mixed
      multi-selection, exclude filtering, multi labels, Load disabled
      on multi, empty-list disabled states, surface-append point

## Testing decisions

Pure core tested in vitest (pattern: `adjacency.test.ts`,
`suggest.test.ts`); hook stays thin (queries/mutations/toasts — not
worth mocking react-query); SetDetailPane/Library wiring rides on the
seam without component suites.

## Notes

- Library.tsx is a structural hotspot (parallel-work.md): check
  `.lanes/` for claims at implementation time; land promptly rather
  than parking long.
- Issue 18 (Set view row selection + group drag) upgrades this menu to
  multi for free via the targeting rule + multi-aware core.

## Blocked by

—

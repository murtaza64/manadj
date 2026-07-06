# 02 — Sync imports skip cache invalidation; engine beat-jump tempo has per-surface wiring gaps

Status: done (verified — fixed in the same change that filed this)
Type: bug

Found by the post-01 BPM/grid divergence audit (2026-07-05). Two easy
halves of that audit's findings; the design-decision items are tracked
separately.

## Bugs

1. **UnifiedTracksSync imports mutated server state with no cache
   invalidation** (`UnifiedTracksSync.tsx` — only `['sync-status']` was
   refreshed). `importBeatgrid`/`bulkImport` replace the grid AND write
   `track.bpm` server-side; `syncMetadata`/rekordbox imports write track
   rows. With `['beatgrid', id]` at `staleTime: Infinity`, waveform beat
   lines, BpmControl projection, and a loaded deck's Quantize grid
   (useDeckBeatgridSync, issue 01) all served pre-import data until
   reload.
2. **`DeckEngine.jumpBeats` tempo refreshed only via per-surface
   `setTrackBpm` calls** (3 BpmControl `onCommitted` sites). Missed:
   TagEditor Analyze (`onSave` bypasses the commit chain), sync-view
   imports, and edits while the track is loaded on the OTHER deck
   (TagEditor guard was scope-A only). Symptom: analysis doubles 87→174,
   grid overlay is fresh (issue 01) but beat-jumps move half the visible
   beats.

## Fix

- `UnifiedTracksSync`: `invalidateTrackCaches(trackId?)` /
  `invalidatePerfCaches(trackId?)` called from every import mutation
  (field import, perf import, bulk import incl. the pending-confirmation
  branch, rekordbox import, file import). No id = bulk = prefix
  invalidation.
- `useDeckBpmSync` — scalar sibling of `useDeckBeatgridSync`: one active
  `['track', id]` observer per loaded Deck (same options as
  `useDeckTrack`), pushing `track.bpm` into the engine. Per-surface
  `setTrackBpm` calls kept for immediacy; the observer makes every other
  path converge.
- `DeckEngine.setTrackBpm(trackId, bpm)` — now trackId-addressed like
  `setBeatTimes` (a late push for a previous Load is ignored).

## Verification

- Red→green: 2 engine tests (guarded setTrackBpm), 2 hook tests
  (invalidation refetch re-arms jump math; warm-cache push on mount).
- Manual (headless browser, lane app): track 13 loaded on BOTH decks,
  BPM edited to 100 via deck A's BpmControl — deck B's engine converged
  to 100 with no per-surface wiring (the observer path).
- Gate: pytest 671, vitest 1092 (72 files), build ok, single alembic
  head, eslint clean on touched files (3 pre-existing TagEditor
  exhaustive-deps warnings excepted).

# 02 — Beatgrid tempo is the BPM source of truth wherever a grid exists

Status: wontfix (superseded — the perfdata-lane grill re-scoped this feature; see the re-filed issues in .scratch/performance-data-sync/ on that lane, e.g. 03-beatgrid-origin)

## Parent

`.scratch/performance-data-sync/issues/01-sync-hotcues-beatgrids.md` (follow-up)

## What to build

Wherever BPM is consumed, derive it from the Track's Beatgrid (constant-grid tempo) when one exists, falling back to `track.bpm`. The Engine import made grids the most trustworthy tempo data we hold; `track.bpm` is a lossy copy.

- BPM and effective-BPM displays in the Performance view's deck panels and the Transition editor's deck cards
- Tempo-match math (Performance BPM-match button; Transition editor)
- Beatjump seconds-per-beat math (library player, Performance decks)
- A shared frontend helper (grid tempo → fallback track BPM) so call sites don't reimplement the precedence

Also **guard the BPM-edit regeneration flow**: `TagEditor.handleBpmChange` (and the Transition editor's copy) deletes the beatgrid and regenerates from track BPM — this silently replaces curated/imported grids with auto-grids. Editing BPM must never clobber a grid that isn't auto-generated (reuse the import script's `is_auto_generated_grid` heuristic server-side, or refuse + hint).

## Context

One-time backfill already applied (2026-07-03, ad-hoc script): 443 NULL BPMs filled and 31 drifting BPMs corrected from constant grids; 3 half/double-time ambiguities left for manual review — track 175 (bpm 174 / grid 87), 512 and 593 (bpm 87 / grid 174, all DnB, the 174 grids look right).

## Acceptance criteria

- [ ] A single helper answers "what is this track's tempo" (grid-first) and all listed call sites use it
- [ ] Variable grids (multiple tempo changes): helper returns the first segment's tempo (documented as v1 behavior)
- [ ] Editing BPM on a track with a non-auto-generated grid does not silently regenerate the grid
- [ ] Manual-review trio resolved or explicitly deferred
- [ ] Typecheck, lint, vitest, pytest green

## Blocked by

None - can start immediately.

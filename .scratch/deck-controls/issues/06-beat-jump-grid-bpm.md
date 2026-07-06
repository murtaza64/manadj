# 06 — Beat-jump sizing reads the bpm column, not the grid

Status: needs-triage
Type: task

## Parent

`.scratch/deck-controls/PRD.md`; ADR 0016 (BPM is a projection of the beatgrid).

## Bug

`DeckContext.loadTrackOnto` feeds the engine `bpm: track.bpm ?? null`
(frontend/src/contexts/DeckContext.tsx:153); `DeckEngine.jumpBeats` sizes
jumps from it (frontend/src/playback/DeckEngine.ts:344). On a track whose
bpm column is a stale half-time projection (e.g. Raskal, track 512: column
87, grid 174), beat jumps travel 2× the intended distance — in library,
performance, and Set playback alike.

Found during the planner bpm-authority bugfix (landed 2026-07-05, merge
`tnrurnll`); left out there as not plan-adjacent.

## Fix

Load decks with the grid-first effective BPM:

- `Track.bpm_effective` is already on every tracks API response (grid
  dominant BPM, else the column) and `trackEffectiveBpm(track)` already
  exists in `frontend/src/sets/planner.ts` — one-line change at
  DeckContext.tsx:153, though the helper may deserve a more neutral home
  than `sets/planner` once a third consumer (DeckContext) imports it.
- The Transition editor already overrides via `player.setBpm` with grid
  values (TransitionEditor.tsx:170-172) — no change needed there; verify
  no double-override ordering issue.
- Check the other `trackInfo.bpm` readers while there: the state-snapshot
  bpm (DeckEngine.ts:743) flows into capture `load` events
  (recorder.ts:138,231) — recorded metadata only today, but it would start
  carrying the grid value; and `setTrackBpm` (BPM-edit path) should stay
  consistent with whatever Load now provides.

## Testing decisions

Unit: a deck loaded with a stale half-time track jumps `beats · 60/174`,
not `60/87`. Existing bpmCommit/projection tests cover the projection
itself.

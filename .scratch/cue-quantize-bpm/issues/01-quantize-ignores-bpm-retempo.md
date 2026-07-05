# 01 — Cue quantization ignores BPM re-tempo (stale beatgrid)

Status: needs-triage
Type: task

## Symptom (reported 2026-07-05)

After adjusting a track's BPM — e.g. doubling 87 → 174 — cue-point
quantization still snaps to the OLD 87-BPM beatgrid. Persists across a
track reload onto the deck.

Expected: after a BPM re-tempo, quantized cue placement snaps to the new
grid (BPM and beatgrid are one domain, ADR 0016 — the PATCH re-tempos/
regenerates the grid server-side).

## Repro (as reported; needs verification)

1. Track with a constant 87 BPM beatgrid, quantize on
2. Double BPM to 174 (deck BPM control)
3. Set/move a cue point → snaps to 87-spaced beats
4. Reload the track onto the deck → still 87-spaced

## Code pointers + hypotheses for the triager

Quantize inputs flow: `DeckContext.loadTrackOnto` fetches
`['beatgrid', track.id]` with `staleTime: Infinity` (`DeckContext.tsx:134`)
→ `DeckEngine.beatTimes` snapshot; hotcue snap reads the same query
(`useHotCueActions.ts:66`); snap math itself is pure
(`playback/quantize.ts`, tested).

Ranked hypotheses:

1. **Backend re-tempo doesn't regenerate `beat_times`** (updates
   tempo_changes/bpm only, or the doubling path differs) — grid served
   after the edit is still 87-spaced. Check the BPM PATCH path
   (`bpmCommit.ts` → server) and what `GET /api/beatgrids/{id}` returns
   after a re-tempo.
2. **Cache not invalidated on the path the user edited through** —
   `BpmControl.tsx:118` invalidates `['beatgrid', id]`, but a BPM edit made
   from another surface (library/tag editor metadata, sync import) may not;
   `staleTime: Infinity` then serves the old grid forever, even across
   track reloads (page reload would clear it — worth testing to
   distinguish 1 vs 2).
3. **Engine snapshot staleness only** — `DeckEngine.beatTimes` captured at
   load; if invalidation happened after load and reload-of-track still hit
   fresh-enough cache. (Weakest — reload should refetch if invalidated.)

Open question for the reporter: which surface was the BPM doubled in
(deck BPM control / tag editor / elsewhere)? Hypothesis 2 hinges on it.

## Overlap warning

Lane `looping` owns the Quantize seam (`playback/quantize.ts`,
`quantizeStore.ts`, landed today) and planned to remove a backend
`quantize_to_nearest_beat` snap in `crud.py`. Coordinate before touching;
re-check the repro on current trunk first — the bug may predate or
postdate today's looping landings.

## Comments

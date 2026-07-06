# 01 — Cue quantization ignores BPM re-tempo (stale beatgrid)

Status: done (verified — see 2026-07-05 fix comment)
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

**2026-07-05 — reporter answer:** BPM was doubled via the **deck BPM
control**. That path DOES invalidate `['beatgrid', id]`
(`BpmControl.tsx:118`), which weakens hypothesis 2 and makes hypothesis 1
the lead: the server's BPM write path likely isn't regenerating
`beat_times` (or not for the doubling case). Start there — inspect
`GET /api/beatgrids/{id}` before/after a re-tempo; if `beat_times` spacing
is unchanged, it's a backend bug and the frontend cache machinery is
innocent. Flipped needs-triage → ready-for-agent.

**2026-07-05 — fixed (lane looping, change wpvluvzv):** Hypothesis 1
disproven on trunk — the backend re-tempo is correct (API repro: PATCH
174→87→174 re-spaces `beat_times` 0.3448s→0.6897s→0.3448s, anchor
preserved; covered by `tests/test_beatgrids_router.py`). The bug moved
with looping 01's client-side snap: **transport-class placement gestures
(Main-cue set, loop engage, quantized hot-cue jumps) snapped against
`DeckEngine.beatTimes` — a load-time snapshot never refreshed after a
grid mutation** (`DeckEngine.ts` load / `transportContext()`). Hot-cue
placement (`useHotCueActions`) reads the live query and was already
fresh; the waveform drew the NEW grid while transport snapped to the OLD
one.

Fix: `DeckEngine.setBeatTimes(trackId, beatTimes)` (trackId-addressed, a
late push for a previous Load is ignored) + `useDeckBeatgridSync` — one
active `['beatgrid', id]` observer per loaded Deck in `DeckProvider`,
so ANY grid mutation (BPM re-tempo, nudge, downbeat mark — they all
invalidate that key) refetches and pushes re-spaced beats into the
engine, whatever surface made the edit. Regression tests at the engine
seam (`DeckEngine.test.ts`) and the sync-hook seam
(`useDeckBeatgridSync.test.tsx`). Manual repro (headless browser, real
Performance-view BpmControl, 87→174): cue-down at 10.7332s snapped to
11.0280 (stale 87 grid) before the fix, 10.6832 (174 grid) after.

The "persists across reload" leg did not reproduce on current trunk
(`fetchQuery` refetches invalidated keys; likely a pre-looping-01
observation). Backend `quantize_to_nearest_beat` removal: already landed
with looping 01 — nothing pending, nothing smuggled in here.

History note: trunk change `oozvmqrn` is mislabeled — it carries this
issue's description but contains the sets issue-33 docs file (a
workspace race: a docs fast-path `bookmark move main --to @` landed the
wrong `@`). The actual fix is the change named
`cue-quantize-bpm: 01-quantize-ignores-bpm-retempo (fix)`.

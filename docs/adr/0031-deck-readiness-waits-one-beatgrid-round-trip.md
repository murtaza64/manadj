# Deck readiness waits one beatgrid round trip, never analysis

Status: accepted (grill 2026-07-10)

`DeckEngine.load()` awaited the deck's beatgrid fetch — including its
bounded retry ladder (5 attempts, ~30s) riding out background analysis —
between audio decode and `ready`. A freshly imported Track loaded onto a
Deck therefore stalled `ready` (and any latched play) for the whole retry
window, even though gridless playback is first-class. Decisions:

## 1. Ready after decode plus one beatgrid round trip

`load()` awaits the beatgrid query's *first settlement* — one request, no
retries — then flips `ready` and fires any latched play. The request runs
concurrently with the audio fetch/decode, so on the common path (grid
exists) it settles before decode finishes and costs ~0ms, preserving
today's guarantees: latched play starts at the first beat; no
unsnapped-Quantize window. On a fresh import the 400 (waveform missing)
settles in one fast round trip → ready, gridless. Retries never gate
readiness. No timeout cap on the single request: it targets the same
server that just delivered the audio bytes — if it hangs, audio is
broken too.

## 2. The Main cue default is live until touched

The load-time resolution stays `saved ?? firstBeat ?? firstNonSilence`,
but a Beatgrid arriving on a still-untouched Deck (no saved cue, never
played, cue still at the load-time default) re-parks cue and playhead at
the first beat. The first play or cue move freezes it — "cue defaults are
a load-time decision" then holds as before. This replaces the guarantee
the blocking await used to provide. Corollary: imports never persist a
computed `cue_point_time` — persisting the default would freeze the worse
value and make unset indistinguishable from set.

## 3. One cache, one delivery path; retrying lives in the sync observer

The load path and `useDeckBeatgridSync` share `['beatgrid', id]`; the
grid reaches the engine only via the sync's `setBeatTimes`. The load-time
`cueDefaults` promise shrinks to the single-settlement wait
(`savedCuePoint` passes synchronously — it's on the Track row). All
retry/poll behavior belongs to the observer, not the ready path.
Implementation note: rather than fighting react-query's per-caller retry
config (`fetchQuery` retry:false deduping against the observer's
retry:5 in-flight fetch), the sync may expose its first settlement to
the load path.

## 4. Deck-scoped arrival polling closes the detection gaps

Background analysis completion writes only the DB — no push, no
invalidation — so two gaps existed: retry exhaustion (grid lands after
the ~30s window; the errored query never refetches) and placeholder
staleness (`staleTime: Infinity` on a served `origin: "generated"` grid
never yields to the analyzed grid). While a Track is loaded on a Deck and
its grid is missing or placeholder-origin, poll `['beatgrid', id]` at a
modest interval (~5-10s), stopping when a saved-origin grid arrives or
grid diagnostics (`GET /api/analyze/grid/{id}`) report `bailed`. The same
poll-while-missing applies to `['waveform-blob', id]` (terminate on
success; waveforms are immutable). Deck-scoped = bounded at two Tracks;
`useDeckBeatgridSync` remains the sole funnel into the engine, for edits
(optimistic jog, round-trip nudges, BPM commits) and late analysis alike.

## Considered and rejected

- Keep awaiting the retry ladder (status quo) — rejected: gates play on
  analysis for up to ~30s on fresh imports, the case where instant play
  matters most.
- Unconditional ready-on-decode (no grid wait at all) — rejected: gives
  up first-beat latched play and opens an unsnapped-Quantize window even
  on analyzed tracks, buying nothing — the single round trip is free on
  the common path.
- Push (SSE/websocket) on analysis completion — rejected: new infra for
  a once-per-import event; revisit if near-real-time needs accumulate
  (analysis progress, multi-client).
- Import-time persisted cue from first audio — rejected: backend would
  decode audio to bake in a value the frontend derives free at load, and
  a persisted default can't upgrade when the grid arrives (§2).

## Out of scope

The library table's bpm/key columns still refresh only on focus/explicit
invalidation; background analysis stays invisible there.

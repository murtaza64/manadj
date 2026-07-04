# 02 — Deck scopes + performance engine groundwork

Status: done (implemented, change ltzwtqqo)

## Parent

`.scratch/performance-mode/PRD.md`

## What to build

The addressing and engine primitives the Performance view needs, with the library untouched in behavior.

- `<DeckScope deck="A|B">` context: `useDeck()`, `useDeckSnapshot()`, `useDeckReady()`, `useHotCueActions()` keep their signatures and read the nearest scope. The library view wraps its tree in scope A — Player, HotCue, keyboard hub, TagEditor work unchanged. `loadedTrack`/`loadTrack` become per-deck.
- `useMixer()` hook exposing channel strip controls (trim, EQ bands, filter, fader per channel), crossfader, and master against the Mixer module from issue 01.
- Engine nudge: `setBend(percent)` / `setBend(0)` — a momentary rate multiplier stacked on pitch (`rate = (1 + pitch/100) x (1 + bend/100)`), clock re-anchored on change, exposed in the snapshot, auto-cleared on Load. ±2% UI constant.
- Per-deck beatjump size state in the deck scope (default 32; halve/double bounds 1-128). The library view keeps using the fixed constant.
- BPM-match pure function: given own base BPM and the other deck's effective BPM, pick the nearest reachable of {other, other x2, other /2} within ±8% (preferring direct when several reach); returns the pitch to set or an out-of-reach verdict.

## Acceptance criteria

- [ ] Library view works exactly as before, now inside `<DeckScope deck="A">` (parity by ear + existing tests)
- [ ] Deck B is loadable and playable through mixer channel B (verified via a throwaway console/dev call — no UI yet)
- [ ] vitest: bend/pitch rate composition and auto-clear-on-load; BPM-match candidates, direct-preference, clamp, out-of-reach; beatjump size bounds
- [ ] `setBend` release restores the exact prior rate; snapshot exposes bend for button styling
- [ ] `make typecheck`, eslint on touched files, vitest, pytest all green

## Blocked by

- 01-mixer-owns-audio-graph

## Comments

Implemented in jj change `ltzwtqqo` (performance-mode: 02-deck-scopes-engine-groundwork).
- `playback/tempo.ts` (+ tests): `composeRate` (rate = (1+pitch/100)×(1+bend/100)), `effectiveBpm`, `bpmMatch` (candidates {other, ×2, ½} vs the other deck's effective BPM, ±8% with edge epsilon, direct preferred, out-of-reach verdict), `PITCH_RANGE_PERCENT` moved here, `NUDGE_BEND_PERCENT = 2`.
- `playback/beatjump.ts` (+ tests): halve/double/clamp within 1–128, default 32; library keeps `constants.BEATJUMP_BEATS`.
- `DeckEngine`: `setBend(percent)` — shared `setRateComponents` re-anchors the clock at the old rate before stepping to the composed rate; `bendPercent` in the snapshot; auto-cleared on Load (pitch persists). Engine-level vitest via public interface with an untouched port (no Web Audio).
- `DeckProvider` now owns both decks + registry + `MixerContext`; new `<DeckScope deck="A|B">` provides the unchanged `DeckContext` — all deck hooks keep their signatures. Per-deck loadedTrack/loadTrack/beatjump size; scope values memoized per deck so A's loads never re-render B's subtree. Cue persistence wired for both engines.
- `useMixer()` (hooks/useMixer.ts) returns the Mixer instance (strip setters, crossfader, master).
- Library + prototype wrapped in `<DeckScope deck="A">` (App.tsx) — library behavior unchanged.
- Deck B dev verification (throwaway, DEV-only): in the console,
  `__manadj.loadTrackById('B', <id>).then(() => __manadj.engines.B.play())`
  — then e.g. `__manadj.mixer.setFader('B', 0.5)` / `setCrossfader(1)` to hear it on channel B.
- Ear-verification pending user: library parity under scope A; deck B audible through channel B.

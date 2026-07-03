# 02 — Deck scopes + performance engine groundwork

Status: ready-for-agent

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

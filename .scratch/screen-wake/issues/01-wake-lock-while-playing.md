# 01 — Screen wake lock while a Deck plays

Status: ready-for-agent

## What to build

The display must not dim mid-set. Hold a screen wake lock whenever any Deck is playing (the deck-running `playing` flag — previews don't count, same signal the Follow bridge watches); release it when everything pauses. Browsers auto-release wake locks when the tab hides — re-acquire on visibilitychange if a Deck is still playing.

- `frontend/src/playback/wakeLock.ts`: bridge subscribing to both engines (followPlaybackBridge idiom), driving `navigator.wakeLock.request('screen')`. Feature-detect: absent API = silent no-op. Acquire/release failures are logged, never thrown — dimming is a nuisance, not a fault.
- Mounted from DeckProvider beside the follow bridge.
- The Desktop shell is Chromium, so the same web API applies; if eye-verify shows it unreliable there, the fallback is Electron `powerSaveBlocker` (separate issue if needed).

Out of scope: the Transition editor's private player (a paused-decks editing session can still dim; revisit if it annoys).

## Acceptance criteria

- [ ] Display stays awake while a Deck plays (browser + shell), dims normally when all Decks are paused
- [ ] Tab-away and back while playing re-acquires the lock
- [ ] No console errors on browsers without the API
- [ ] Untested-by-design thin glue (bridge idiom, like followPlaybackBridge); gate green

## Blocked by

None - can start immediately

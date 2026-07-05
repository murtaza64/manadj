# Quantize toggle and gesture-time placement snapping

Status: done (implemented, change rtxmzxzs)

## Parent

`.scratch/looping/PRD.md`

## What to build

**Quantize** as a first-class app-wide sticky toggle (glossary; grilled 2026-07-05), replacing the ad-hoc backend snap fragment. A small `Q` button in the top bar beside the MIDI badge — lit when on, default on, persisted to localStorage following the existing hints-toggle pattern, visible and effective in both the library and Performance views.

When on, **placement gestures snap client-side at gesture time**: setting a Hot Cue or the Main cue stores the nearest-beat position (nearest beat, not downbeat) projected through the Track's Beatgrid. When off, placements store the exact playhead position. Gridless Tracks behave as if Quantize were off.

The backend's unconditional nearest-beat snap on hot-cue writes is removed: the API stores what it's told, verbatim. The Engine-import bypass ceases to be a special case — imports aren't gestures and are stored as-is by construction. Backward compatibility is a non-concern.

A pure beat-domain snap helper (position → nearest gridline) should fall out of this slice — issue 03 consumes it for loop regions.

## Acceptance criteria

- [ ] `Q` toggle in the top bar: lit when on, default on for fresh state, persists across reloads, present in both views
- [ ] Quantize on: setting a Hot Cue or Main cue mid-beat stores the nearest-beat position
- [ ] Quantize off: the same gesture stores the exact position
- [ ] Gridless Track: placements store exact positions regardless of the toggle
- [ ] Backend hot-cue writes are stored verbatim (no server-side snap); Engine/Rekordbox performance-data import unchanged
- [ ] Transport-reducer/pure-helper tests cover snap-on, exact-off, and gridless degradation; backend write-path tests assert verbatim storage

## Blocked by

None - can start immediately

## Comments

**2026-07-05 — Done** (jj change `rtxmzxzs`, workspace looping). Quantize store `playback/quantizeStore.ts` (`manadj-quantize`, default on) + TopBar `Q` button (lit green, beside MIDI badge). Pure snap helper `playback/quantize.ts` (`snapToNearestBeat`, binary search, gridless passthrough — issue 03 consumes it). Reducer gains `TransportContext` (`{quantize, beatTimes}`, third arg, defaults unquantized); `cue-down` set-branch snaps cue+parked playhead. DeckEngine holds `beatTimes` (CueDefaultsInfo now carries the full grid; first beat derived) and assembles the context per dispatch. Hot-cue placement snaps in `useHotCueSlots.down` via the beatgrid query cache. Backend: `quantize_to_nearest_beat` deleted, `set_hotcue` stores verbatim; sync_performance import unchanged (bypass note retired). Tests: `quantize.test.ts`, `quantizeStore.test.ts`, transport cue-down-under-Quantize block, `tests/test_hotcues_router.py` (verbatim with grid present).

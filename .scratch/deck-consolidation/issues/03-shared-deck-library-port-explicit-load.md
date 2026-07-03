# 03 — one shared Deck + library port + explicit Load

Status: ready-for-agent

## Parent

`.scratch/deck-consolidation/PRD.md`

## What to build

Replace the library's `<audio>`-element stack with the shared buffer engine, and decouple browsing from loading (ADR 0008).

- A provider above the view switch owns a single `DeckEngine`; Library and Practice consume the same engine (Practice stops constructing its own). Playback state survives view switches; only one thing can ever play.
- Library port: the Player's transport UI, hot cue buttons (set/jump/preview/delete stay working), and the keyboard hub call the engine directly. One-shot playhead reads (hot-cue set, set-downbeat, tag editor's current time) use the engine playhead. Library waveform + minimap switch from the element-clock adapter (issue 02) to the engine clock — the adapter dies.
- Explicit Load: Enter or double-click loads the selected track onto the Deck; selection (j/k, click) is browse-only. Player/waveform/minimap follow the Deck; tag and energy editors follow the selection. Keyboard scope split: curation keys (tags, energy) act on the selected row; performance keys (space, cue, beatjump, scrub, hot cues, set-downbeat, beatgrid nudge) act on the Deck. Beatgrid controls in the tag editor disable with a hint when the edited track is not the loaded Track.
- Held-key scrub uses the engine seek loop (judge by ear: if per-frame restarts stutter, throttle restarts or move the playhead silently while scrubbing).
- Delete the old audio context module, the hidden `<audio>` element, the Player's imperative handle, and `seekVersion`. Do not port: exposed element ref, `volume`/`setVolume`, the hot-cue-previewing record (the engine's single preview slot supersedes it).

## Acceptance criteria

- [ ] Loading a track in Library, flipping to Practice and back: same track, same playhead, same cue state; EQ/filter/pitch changes made in Practice are audible in Library
- [ ] Enter and double-click load the selected track; j/k and single click never trigger a load or fetch
- [ ] Library parity: play/pause, cue press/hold semantics, beatjump, held-key scrub, hot cue set/jump/preview/delete all work as before (per the transport tests from issue 01)
- [ ] Performance keys act on the loaded Track even when a different row is selected; tag/energy keys act on the selection
- [ ] Beatgrid set-downbeat/nudge are disabled (with hint) when the edited track ≠ loaded Track
- [ ] The old audio context module and hidden `<audio>` element no longer exist; no `seekVersion`, no imperative player handle, no element-clock adapter
- [ ] `make typecheck`, frontend lint on touched files, vitest, and backend pytest all green

## Blocked by

- 02-renderer-clock-seam-practice-waveforms

## Comments

Implemented in jj change `snpqzttm` (deck-consolidation: 03-shared-deck-library-port-explicit-load).
- DeckProvider above the view switch; context carries stable refs only; deck state read via `useDeckSnapshot(selector)` so transport events don't re-render the library tree (fixes play-start jitter caused by main-thread render bursts starving the rAF loop — confirmed by filtering the table).
- Player/HotCue/keyboard hub on the engine; explicit Load (Enter + double-click, loaded-row accent); keyboard scope split; TagEditor beatgrid gating with hint; minimap follows the Deck.
- Deleted: AudioContext.tsx, useAudio.ts, elementClock, PlayerHandle, seekVersion. Not ported: volume, hotCuePreviewing record.
- Review fixes: Enter ignored when a button has focus; jumpBeats falls back to 120 BPM (library parity); scrub loop and hot-cue set-or-trigger deduplicated (useScrubLoop, useHotCueActions); BEATJUMP_BEATS shared constant; TrackRow memoized; Player time readout moved to rAF-textContent.
- Saved-cue restore intentionally absent (issue 04).

Perf follow-ups landed in the same change after user testing:
- Narrowed deck-state consumption (`useDeckSnapshot(selector)`, stable-ref context value) — transport events no longer re-render the library tree (verified with render probes: zero renders during scroll/playback).
- Remaining jitter traced to clock-driven DOM text writes (readouts): a DOM text mutation forces style/layout/display-list work that scales with document size (Firefox, 1000-row table). Fix: time/bar readout moved onto the renderer's per-frame 2D overlay canvas (`showTimeReadout` config); PlayerTime/DeckReadout DOM readouts deleted. Rule going forward: DOM for event-driven UI, canvas for clock-driven display.
- TrackRow memoized; probes removed after confirmation.

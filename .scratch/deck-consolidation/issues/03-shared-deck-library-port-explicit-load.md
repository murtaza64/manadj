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

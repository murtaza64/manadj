# PRD: Deck consolidation — buffer engine everywhere, one shared Deck

Status: ready-for-agent

## Problem Statement

As a DJ, the Practice view's buffer-based Deck is dramatically better than the library player — instant cue stabs, beatjumps, and scrubbing — but the library still runs on the old `<audio>`-element stack: laggy seeks, a waveform renderer carrying ~500 lines of clock-jitter compensation, cue points that vanish on track change, and two playback stacks that can (absurdly) play at once. Before building more mixing features, the good implementation should become the only implementation.

## Solution

Delete the `<audio>`-element stack and consolidate on the buffer-based `DeckEngine` (ADRs 0007, 0008): one shared Deck above the view switch, rendered by both Library and Practice. The waveform renderer is stripped to depend on a clock interface instead of an audio element, its twin component lifecycles collapse into one shared hook, and the Practice view gains real waveform + minimap. Loading a Track onto the Deck becomes an explicit act (Enter / double-click), decoupling browsing from playback as in DJ hardware. The Main cue gets CDJ memory-cue behavior: persisted per Track, defaulting to the first beat (else first non-silence). Pure playback modules gain vitest tests.

## User Stories

1. As a DJ, I want the library player to have the Practice deck's instant transport (cue stabs, beatjumps, scrub), so that working tracks in the library feels like hardware.
2. As a DJ, I want one Deck shared across views, so that a track loaded in the library is still loaded — same playhead, same cue — when I flip to Practice and back.
3. As a DJ, I want only one thing playing at a time, so that switching views never leaves a second hidden playback running.
4. As a DJ, I want to browse tracks with j/k or clicks without triggering loads, so that browsing is instant and free.
5. As a DJ, I want to load the selected track onto the Deck explicitly with Enter or double-click, so that loading is intentional, like on a CDJ.
6. As a DJ, I want the Deck to keep its Track while I browse elsewhere, so that playback and curation don't interfere.
7. As a DJ, I want the Main cue I set to persist with the Track across loads and sessions, so that my cue is where I left it.
8. As a DJ, I want an unset Main cue to default to the first beat (or first non-silent audio when there's no Beatgrid), so that cueing a fresh track starts somewhere musical.
9. As a DJ, I want the scrolling waveform and minimap in the Practice view, so that I can navigate visually while practicing.
10. As a DJ, I want waveform playhead motion to be smooth and exact, so that beatgrid ticks and the playhead line up with what I hear.
11. As a DJ, I want drag-to-scrub and wheel zoom on the library waveform to keep working after the port, so that nothing regresses.
12. As a DJ, I want hot cue set/jump/preview/delete to keep working in the library, so that performance data curation is unaffected.
13. As a DJ, I want performance keys (space, cue, beatjump, scrub, hot cues) to act on the loaded Deck and curation keys (tags, energy) to act on the selected row, so that the two workflows never collide.
14. As a DJ, I want beatgrid editing (set downbeat, nudge) to apply to the loaded Track only, so that playhead-dependent edits can't corrupt a track I'm merely browsing.
15. As the developer, I want the renderer to depend on a clock interface rather than an audio element, so that future decks, views, or a native backend can drive it.
16. As the developer, I want one waveform component lifecycle instead of two line-for-line twins, so that renderer fixes land once.
17. As the developer, I want the jitter-compensation and telemetry code deleted rather than maintained, so that the renderer is comprehensible again.
18. As the developer, I want the transport reducer and DSP mappings under unit tests, so that the port can't silently change cue semantics.
19. As the developer, I want the abandoned waveform prototype and its CORS whitelist entry gone, so that dead code stops suggesting wrong directions.

## Implementation Decisions

- **Big-bang** (ADR 0008): no transitional dual-clock support; intermediate breakage of the library waveform mid-work is acceptable. Order of work: Practice view gets waveforms first (proving the renderer-on-engine-clock), then the library ports.
- **One shared engine**: a provider above the view switch owns a single `DeckEngine` and exposes it with the subscription pattern the Practice view already uses. The old audio context module is deleted, along with its hidden `<audio>` element.
- **Not ported** (confirmed dead or superseded): exposed audio-element ref (one-shot playhead reads become engine playhead reads — also fixing the stale-per-render read passed to the tag editor), `seekVersion`, `volume`/`setVolume` (zero consumers), the Player's imperative handle (the keyboard hub calls the engine directly), `hotCuePreviewing` record (superseded by the engine's single preview slot).
- **Renderer clock seam**: the renderer takes a clock interface (playhead, running state, rate) instead of an audio element. All interpolation/startup-prediction/anomaly-suppression/telemetry machinery (~500 lines) is deleted — the engine clock is sample-accurate and monotonic. Hard-sync effects and `seekVersion` plumbing in the waveform components go with it.
- **Shared waveform hook**: one hook owns the renderer lifecycle (construct, feed waveform/beatgrid/hot-cue/cue data, start/stop render loop, dispose); the full waveform and minimap become thin configurations of it. Drag-to-scrub routes through the engine (pause → seek → resume on release) and the clock interface, not by mutating renderer fields.
- **Practice view**: gains scrolling waveform (playhead at 25%, drag-scrub, wheel zoom, beatgrid/hot-cue/cue markers) and minimap via the shared hook; the dumb canvas timeline is deleted; the time/bar readout is kept. The Practice UI remains throwaway — it is the embryo of a future performance/2-deck view.
- **Explicit Load**: Enter (and double-click) loads the selected track onto the Deck. Selection j/k and click are browse-only. The Player, waveform, and minimap follow the Deck; tag/energy editors follow the selection. Keyboard scope split: curation keys (tags, energy) act on selection; performance keys (space, cue, beatjump, scrub, hot cues, set-downbeat, beatgrid nudge) act on the Deck. Beatgrid controls in the tag editor disable with a hint when the edited track is not the loaded Track.
- **Main cue persistence**: engine `load()` accepts an initial cue. Precedence when loading: saved cue → first beat (caller supplies from Beatgrid) → first non-silence (engine computes from the decoded buffer) → 0.0. Setting a cue persists through the existing waveform cue-point endpoint; defaults are not persisted until the user sets a cue. The engine stays framework-free and API-ignorant — persistence lives in the React layer, observing cue changes.
- **Engine additions required**: initial-cue parameter on load; first-non-silence scan of the decoded buffer; whatever clock accessors the renderer interface needs (rate already exists via pitch).
- **Cleanup**: the abandoned `waveform-webgl` prototype directory and its CORS whitelist entry are deleted.
- **No new backend endpoints.** The waveform cue-point PATCH exists and is currently uncalled; the audio endpoint already serves fast range-capable responses.

## Testing Decisions

- **vitest enters the repo**, scoped to pure modules only — no Web Audio mocking, no jsdom, keeping faith with ADR 0002 (tests exercise module interfaces, no mocks):
  - Transport reducer: the press/hold cue semantics (cue set / preview / return-to-cue, hot-cue preview interplay with play, ended behavior) — these encode the behaviors the library player must not lose in the port.
  - Graph mappings: EQ value→gain (kill is exactly 0, flat exactly 1, +6dB top), sweep position→filter (bypass deadzone, LP/HP ranges).
  - Default-cue precedence logic once it exists.
- `DeckEngine`, the renderer, and views stay ear/eye-verified against real playback.
- Existing backend suite must stay green (no backend changes expected).
- Manual verification: library cue/beatjump/hot-cue/scrub parity with pre-port behavior; waveform playhead alignment against beatgrid ticks; cue persistence across reload.

## Out of Scope

- Second deck, crossfader, transitions, performance-view UI design
- Keylock/time-stretch (still the largest open platform risk)
- Mix recording
- EQ/filter/pitch controls in the Library UI (the Deck has them; the Library view doesn't show them)
- Volume/master-gain control (add only when a real need shows)
- Renderer feature work beyond the port (visual redesign, new markers)
- Playlist/auto-advance behavior changes

## Further Notes

- ADR 0008 records the consolidation decisions; ADR 0007 (accepted) records the buffer-engine platform verdict.
- Glossary: **Deck** (one, shared, outlives views), **Load** (explicit act), **Main cue** (persisted, CDJ behavior) were updated during design.
- The architecture review's candidate 7 (waveform renderer twin lifecycles, telemetry bloat, abandoned prototype) is fully absorbed by this work.
- Known UX watch-item carried over from the spike: held-key scrub restarts the source every frame; if it feels stuttery, throttle restarts or move the playhead silently during scrub — decide by ear during the port.

# One shared Deck: the buffer engine replaces the audio element everywhere

Status: accepted

Following the Practice-view spike (ADR 0007), the `<audio>`-element stack is deleted rather than maintained in parallel: a single shared `DeckEngine` lives above the view switch, and Library and Practice are views over the same Deck. Done as a big-bang — no transitional dual-clock support — since the project has one user.

## Decisions folded in

- **One Deck, not one per view.** Playback state survives view switches; future mixing views create a second Deck deliberately (Deck A/B), never as a view artifact.
- **The waveform renderer depends on a clock interface** (`getPlayhead()` et al.), not on an audio element. The engine clock is sample-accurate and monotonic, so the renderer's ~500 lines of jitter compensation (interpolation, startup prediction, anomaly suppression, telemetry) are deleted, along with the `seekVersion` resync mechanism.
- **Loading a Track onto the Deck is explicit** (Enter/double-click), breaking today's selection-implies-loaded coupling — matching DJ-hardware expectations and making the decode cost an intentional, per-Load act.
- **Main cue is persisted** (CDJ memory-cue behavior) via the existing waveform cue endpoint; default when unset: first beat, else first non-silence, else 0. The engine stays framework-free and API-ignorant — persistence happens in the React layer.
- **Dropped, not ported:** exposed `audioRef`, `volume`/`setVolume` (zero consumers existed), the `PlayerHandle` imperative ref (keyboard hub calls the engine directly).

## Consequences

- Every track selection no longer costs a fetch; every Load costs a fetch+decode (~1s, abortable fetch).
- Keyboard shortcuts split by scope: curation keys act on the selected row, performance keys (transport, hot cues, beatgrid set/nudge) act on the loaded Deck.
- vitest enters the repo, scoped to pure playback modules (transport reducer, graph mappings) — no Web Audio mocking, per ADR 0002's no-mocks stance.

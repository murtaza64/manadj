# Always-on capture: Handover detector, persisted Takes, minimal Transition history

Status: ready-for-agent

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

The tracer bullet: mix in the Performance view, and a **Take** appears in the **Transition history**.

- **Event log**: one timestamped event format shared by the live tap and the detector — control events (channel faders, crossfader, EQ, filter, pitch, Nudge), transport events (play/pause/seek/beat-jump/hot-cue, Load), and enough deck context to reconstruct Master-bus audibility and alignment. The shared Decks+Mixer surface feeds an in-memory rolling log, always-on, ephemeral (dies with the tab). The Transition editor's private surface never captures.
- **Detector**: a pure module (event stream in → Takes out) implementing the full Handover definition from the glossary: audibility passes finally from outgoing to incoming; a settle horizon folds cross-cuts into one Handover; tease-and-bail yields nothing; zero-overlap hard cuts count; Cue-bus (PFL) audibility is invisible; a session ending mid-blend counts if the incoming was audible at the outgoing's end. Thresholds/horizons live in one versioned parameter set; the detector version is stamped on every Take.
- **Persistence**: a `takes` table (Alembic migration per ADR 0005) and CRUD router following the transitions pattern — pair FKs with roles (outgoing → incoming, deck-agnostic), detected-at, window bounds, detector metadata (confidence, version), promoted-Transition reference (empty for now), raw event slice as opaque JSON. Immutable apart from the promoted reference and deletion.
- **History UI**: a minimal chronological list — pair (outgoing → incoming), detected-at, window length, confidence — with manual delete. Placement per implementation judgment; opening entries in the editor is issue 03.

## Acceptance criteria

- [ ] Performing a clean blend in the Performance view produces exactly one Take, visible in the Transition history with pair, time, window length, and confidence
- [ ] A hard cut (crossfader flick, no overlap) produces a Take
- [ ] Cross-cuts within the settle horizon fold into a single Take (one engagement window, not two Takes)
- [ ] A tease where the outgoing Track survives produces no Take
- [ ] PFL-only previewing produces no Take
- [ ] Stopping both decks mid-blend produces a Take when the incoming was audible at the outgoing's end
- [ ] Take direction reflects outgoing → incoming Tracks regardless of physical deck assignment
- [ ] Pure detector tests cover every scenario above with synthetic event streams (prior art: the editor domain-model and transport-reducer suites); no Web Audio in detector tests
- [ ] Takes persist across reload; raw event slice stored opaquely; detector version and parameters recorded per Take
- [ ] A Take can be deleted from the history; nothing auto-prunes
- [ ] Transition-editor playback records nothing
- [ ] Backend router has TestClient smoke tests (status + shape), matching the transitions router's tests

## Blocked by

None - can start immediately

## Further notes

Human checkpoint after landing: the developer practices real mixes and audits the history for false positives/negatives before issue 05's tuning pass. Design detection parameters to be easy to adjust in one place.

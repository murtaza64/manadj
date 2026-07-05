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

## Comments

**Done** (jj change `nxxvnwvm`, lane `takes01`, 2026-07-05). All acceptance criteria met:

- **Event log**: one `CaptureEvent` format (`frontend/src/capture/events.ts`) shared by tap and detector — controls, transport, pitch/bend, loads, ~1 Hz ticks with playhead samples. Monotonic capture clock (audio clock freezes when displaced). In-memory rolling log, pruned (idle 30s / engagement-covering).
- **Detector**: pure reducer (`detector.ts`, transport.ts house style), 19 scenario tests. Full Handover semantics: overlap + hard-cut (≤2s gap) engagement, cross-cut folding via 8s settle horizon, tease-and-bail dissolution, PFL invisible, mid-blend end (0.5 confidence), lazy handover, chaining, deck-agnostic direction. Audibility = playing × trim × fader × crossfader ≥ threshold, plus EQ-full-kill and filter-ridden-to-end cessations (review finding). Cessation-first edge ordering and cessation-time track snapshot close two attribution races (review findings). Params versioned (`DETECTOR_VERSION 1`), stamped per Take.
- **Persistence**: `takes` table (migration `0017_nxxvnwvm`), create/list/detail/delete router mirroring transitions; window bounds stored (`window_start_s`/`window_end_s` — review finding: bounds, not bare duration), params + raw slice opaque JSON, `promoted_transition_uuid` column ready for issue 03. 7 TestClient smoke tests.
- **Tap**: `CaptureRecorder` in DeckProvider (glue, untested by policy) — mixer subscribe diffs (table-driven), deck snapshot diffs, new `DeckEngine.setTransportEventHandler` for playhead discontinuities (seek/jump/hot cue — vectorization evidence for issues 03/04).
- **History UI**: new top-panel mode (`history`): newest-first table (pair via track titles, when, window length, confidence, promoted mark, delete), live-refreshes on `manadj:take-recorded`.

Known v1 behaviors, deliberate:
- Entering the editor mid-blend pauses the shared decks and can emit a 0.5-confidence Take — a known false-positive class, kept for issue 05 tuning (recorder.ts doc comment).
- Settlement lags up to ~1s behind the tick cadence (window bounds stay event-exact); worse in throttled background tabs.
- A tab crash mid-blend loses that Take (PRD: accepted).

Human checkpoint now open: practice real mixes, audit the history (this is the issue-05 gate).

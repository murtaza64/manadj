# PRD: Transition Takes — automatic capture of live handovers

Status: ready-for-agent

## Problem Statement

When I practice mixes in the Performance view, the good ones evaporate. I beatmatch, ride the faders, nail a double drop — and the only artifact is my memory. To keep a move I have to reconstruct it by hand in the Transition editor afterward, which loses the details and usually doesn't happen. The Transition library is supposed to accumulate "what mixes well into what," but my actual mixing — the richest evidence there is — contributes nothing to it.

## Solution

The shared Decks+Mixer captures live performance continuously, with no arming gesture. When a Handover settles (audibility passes finally from the outgoing Track to the incoming), the engagement is saved as a **Take** — the track pair plus the raw recorded performance — into the **Transition history**, a chronological log of what was actually mixed. Takes are reviewable in the Transition editor: opening one derives an ordinary Transition draft from the raw events (idealized — fingering noise removed, intentional structure kept), and saving it **promotes** it into the Transition library through the normal save path. Unpromoted Takes remain as audit data and as the tuning ground for the detection heuristics.

Decisions recorded in ADR 0020; glossary terms Take, Handover, Jump event, Transition history in CONTEXT.md.

## User Stories

1. As a DJ practicing in the Performance view, I want every real handover I perform to be captured automatically, so that a good take is never lost because I forgot to arm a recorder.
2. As a DJ, I want capture to be zero-gesture and invisible while mixing, so that practicing feels identical with the feature on.
3. As a DJ, I want a Transition history listing my Takes chronologically, so that I can answer "what did I actually mix last night?"
4. As a DJ, I want each history entry to show the pair (outgoing → incoming), when it happened, and its window length, so that I can find a specific take quickly.
5. As a DJ, I want to open a Take in the Transition editor, so that I can audition what I actually played on the editor's timeline.
6. As a DJ, I want the opened Take to arrive as an unsaved Transition draft, so that promoting it is just the save I already know, and abandoning it costs nothing.
7. As a DJ, I want to tweak the derived lanes and anchors before saving, so that promotion is a curation step, not a blind import.
8. As a DJ, I want promotion to add a Transition to the library for that pair, so that my proven moves feed discovery like any drawn Transition.
9. As a DJ, I want my beatmatching corrections (Nudges, pitch riding) collapsed into a single clean alignment and tempo-match, so that the promoted Transition is the move I meant, not my hand jitter.
10. As a DJ, I want my mid-mix beat jumps and hot-cue presses preserved as Jump events, so that a doubled buildup survives promotion intact.
11. As a DJ, I want crossfader and channel-fader work captured as the resulting per-deck gains, so that the promoted Transition sounds like what I played regardless of which control I used.
12. As a DJ who cross-cuts (dnb teases, double drops), I want brief returns of the outgoing track folded into one Take, so that a tease doesn't produce spurious history entries or split my transition in two.
13. As a DJ, I want a tease where I bail back to the original track to produce no Take at all, so that the history reflects handovers, not experiments.
14. As a DJ, I want zero-overlap hard cuts detected as Handovers, so that cut-style mixing is first-class.
15. As a DJ, I want headphone (PFL/Cue bus) previewing to be invisible to detection, so that auditioning the next track never pollutes the history.
16. As a DJ, I want a Take to record which Track was outgoing and which incoming regardless of physical deck, so that the history and library stay directional and deck-agnostic.
17. As a DJ, I want Takes kept indefinitely by default, so that the history is a durable record of my practice.
18. As a DJ, I want to delete a Take manually, so that junk captures don't clutter the history forever.
19. As a DJ, I want promoted Takes to remain in the history with a mark linking to the Transition they produced, so that I can see which takes I kept.
20. As a DJ, I want to jump from a history entry to its promoted Transition in the editor, so that review round-trips are one click.
21. As a DJ reviewing history, I want to see detection confidence/metadata per Take, so that I can judge borderline captures.
22. As the developer tuning detection, I want Takes to store the raw event slice, so that improved detectors and vectorizers can re-derive old Takes instead of being frozen at capture time.
23. As the developer tuning detection, I want false positives to persist in the history (until deleted), so that the tuning ground includes the detector's mistakes.
24. As the developer tuning detection, I want promoted-vs-unpromoted status queryable, so that keep decisions become labeled data.
25. As a DJ, I want a Take of a pair that already has Transitions to promote as an additional Transition on that pair, so that multiple takes of the same pairing coexist as the model already allows.
26. As a DJ, I want the editor to open a Take with the outgoing Track in the A role, so that the review always reads left-to-right like every other Transition.
27. As a DJ, I want playback of a promoted Transition with Jump events to reproduce the jump audibly, so that a doubled buildup plays back as performed.
28. As a DJ, I want to edit or remove Jump events in the editor, so that discrete structure is as curatable as lanes.
29. As a DJ, I want a session that ends mid-blend (both decks stopped during the overlap) still captured if the incoming was audible at the outgoing's end, so that set-closing transitions aren't lost.
30. As a DJ, I want capture limited to the shared surface, so that Transition-editor auditioning never records Takes of itself.

## Implementation Decisions

- **Detection target**: the Handover, as defined in the glossary — Master-bus audibility passes finally from outgoing to incoming; settle horizon folds cross-cuts; teases excluded; hard cuts included; Cue bus invisible. Thresholds/horizons are tunable heuristic parameters, not domain constants.
- **Capture is frontend-only and always-on** on the shared Decks+Mixer surface. The pre-detection rolling event log is in-memory and ephemeral (dies with the tab; acceptable v1 loss). The Transition editor's private surface never captures.
- **Event log format**: timestamped control and transport events (channel faders, crossfader, EQ, filter, pitch, Nudge, play/pause/seek/beat-jump/hot-cue, Load) plus enough deck context (loaded Track, playhead reference, pitch) to reconstruct audibility and alignment. The live tap and the detector share this one format — synthetic streams in tests are the same shape as real capture.
- **Detector and vectorizer are pure modules**: event stream in → Takes out; raw Take slice in → Transition draft out. No Web Audio dependency in either.
- **Take persistence**: a new backend `takes` table + CRUD router following the transitions pattern — track-pair FKs, detected-at, window bounds, detector metadata (confidence, detector version), promoted-Transition reference, raw event slice as opaque JSON. Alembic migration per ADR 0005. Takes are immutable apart from the promoted reference and deletion.
- **Promotion = the existing editor save path**: opening a Take vectorizes it into an unsaved draft (lazy-persistence rules apply); saving persists an ordinary Transition via the existing client-authoritative pair replace (ADR 0011) and writes the promoted reference back to the Take. Outgoing Track always takes the editor's A role.
- **Idealization at vectorization** (ADR 0020): continuous gestures collapse into static `bInSec` (chosen at the handover's commit point) and static tempo-match; crossfader × channel fader compose into the `faderA`/`faderB` lanes; discrete gestures become Jump events.
- **Jump events extend the Transition model**: incoming-Track-only playback discontinuities at a mix instant. Arrangement math becomes piecewise for B; the editor renders and edits them; MixPlayer seeks the B deck at jump instants. The Sketch origin invariant is untouched. Templates do not carry jumps.
- **Transition history UI**: a browsing surface listing Takes (chronological; filter by pair), each entry opening the editor. Placement (panel vs. view) decided at implementation; it is not a library-view concern.
- **Retention**: keep everything; manual delete only.

## Testing Decisions

- Tests exercise module interfaces with real internals (ADR 0002); assert external behavior — Takes emitted, drafts derived — never detector internals.
- **Detector** (pure, vitest): synthetic event streams for every Handover scenario — clean blend, hard cut, cross-cut folding within the settle horizon, tease-and-bail (no Take), PFL-only preview (no Take), session ending mid-blend, back-to-back handovers chaining. Prior art: the pure-model suites for the editor domain model and transport reducer.
- **Vectorizer** (pure, vitest): synthetic Take slices → asserted draft shape: composed fader lanes (crossfader flick → rectangular cut), Nudge/pitch-ride collapse to single alignment + tempoMatch, beat-jump/hot-cue extraction to Jump events, anchor derivation.
- **Transition model extension** (existing vitest suite): Jump-event arrangement math alongside the existing slide/crop/chop tests.
- **Backend** (existing pattern): TestClient smoke tests for the takes router — status + shape, promoted-reference update, delete.
- **Untested glue**: the Web Audio tap feeding the log, same policy as the rest of the deck/mixer graph.

## Out of Scope

- Outgoing-side Jump events (noted for later; would restate the Sketch origin invariant — ADR 0020).
- Time-varying alignment or pitch lanes in the Transition model.
- A crossfader lane (ADR 0010 decision stands).
- "Failed take" capture (tease-and-bail as an artifact).
- Whole-session recording, session artifacts, or audio (master-bus tap) recording.
- Take playback as raw replay (exact re-performance of the event slice); review happens through the vectorized draft.
- Jump events in Transition templates.
- Detector auto-tuning/learning pipelines — this PRD only persists the data that makes tuning possible.
- Capture surviving tab crashes (persistent rolling log).

## Further Notes

- Vocabulary: Take, Handover, Jump event, Transition history are in CONTEXT.md; ADR 0020 records the raw-capture / idealizing-promotion trade-offs. Use these terms in code and issues.
- The detector's parameters (audibility threshold, settle horizon, minimum engagement) should be centralized and versioned — the detector version stored per Take is what makes historical re-derivation meaningful.
- Cross-cut captures vectorize naturally into the rectangular fader-cut shape the editor's chop stamp already produces; no new lane vocabulary needed.
- CONTEXT.md is being edited concurrently by another lane (Linked / External Correspondence, 2026-07-05); merge with care at landing.

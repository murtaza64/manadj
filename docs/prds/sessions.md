# PRD: Sessions — the whole performance persists, walkable and replayable

Status: ready-for-agent

## Problem Statement

Take capture is a heuristic oracle: it watches me play, and a history list tells me what it decided to keep. Everything between its verdicts is discarded — a blend the detector missed is gone forever, and I can't check its work. I can't walk back through what I actually played last night to find the good moments myself; I can't re-hear a blend and try a different exit; a crash mid-blend loses the Take; and when the detector improves (multi-deck, Cameos), my past performances are beyond its reach because their evidence no longer exists.

## Solution

The always-on capture tap's rolling log persists in full as a **Session**: one per stretch of live performance — the row opens on the first Master-audible instant, and ten continuous minutes with no Master-audible Deck end it (sessions 11; originally one per recorder lifetime) — one capture clock, all four Decks unconditionally, events only — no audio (ADR 0033). A Session's **timeline** is a scrubbable lens over a night of playing: deck activity and audibility drawn from the events, idle collapsed, machine tenure (editor auditions, Conductor) shown as honest gaps, Takes drawn in place, the detector's rejected and missed verdicts inspectable as ghosts. Clicking a moment **replays it through the shared live Decks** — same engine, perfect fidelity — and yields to takeover like the Conductor, so the rehearsal loop composes: scrub to last night's blend, replay in, grab the fader, exit differently, and the live continuation is captured. Moments the detector missed are **hand-cut** into ordinary Takes (kind and pair derived from the events by the survivor rule, never declared). Re-running an improved detector over old Sessions is explicit and suggest-only: verdicts render as ghosts, accepting one reuses the hand-cut path.

Decisions in ADR 0033; glossary terms Session, and the amended Take, Cameo Take, Transition history in CONTEXT.md.

## User Stories

### Persistence

1. As a DJ, I want my whole performance persisted with no arming gesture, so that the record exists even when I didn't know the night would matter
2. As a DJ, I want the log streamed to disk as I play, so that a crash costs seconds of tail, not the session
3. As a DJ, I want all four Decks logged even when three are audible, so that my triples are on the record even before any detector understands them
4. As a DJ, I want editor auditions, Conductor playback, and Session replay to appear as tenure markers ("a machine held the surface from X to Y"), so that the timeline is honest about gaps without recording machine performances
5. As a DJ, I want a list of my Sessions (when, how long, how many Takes), so that I can find last Tuesday
6. As a DJ, I want to delete a Session without losing any Take, so that pruning history never destroys evidence I've kept
7. As a DJ, I want Sessions kept indefinitely by default, so that the record is durable without a policy to manage
8. As a DJ, I want each Take stamped with its Session, so that history entries and timelines cross-reference

### Timeline

9. As a DJ, I want a scrubbable timeline of one Session showing each Deck's activity and audibility, so that I can see the shape of the night at a glance
10. As a DJ, I want idle stretches collapsed visually, so that a session left open all day reads as an evening of playing
11. As a DJ, I want each Take and Cameo Take drawn in place on the timeline, so that the history list's entries have a where, not just a when
12. As a DJ, I want to open a Take from the timeline into the Transition editor, so that the timeline is a doorway to review, not a dead end
13. As a DJ, I want a Transition history entry to deep-link to its moment on the Session timeline, so that "what was around this Take?" is one click
14. As a DJ, I want the detector's rejected verdicts (tease-and-bail, low confidence, suspended stretches) inspectable as ghosts, so that detection is observable instead of oracular
15. As a DJ, I want the current Session's timeline available live, so that "what did I just play twenty minutes ago" doesn't wait for the night to end
16. As a DJ, I want track names visible along each Deck's lane, so that I can orient by what was playing, not just when

### Replay

17. As a DJ, I want to click a moment and hear it replayed through the shared live Decks, so that what I hear is exactly what the engine played that night
18. As a DJ, I want replay to yield to takeover — any manual gesture ends it and capture resumes — so that I can replay into last night's blend and exit differently, producing a new Take
19. As a DJ, I want replay to be invisible to capture (a machine tenure), so that reviewing never records phantom performances
20. As a DJ, I want mid-set replay allowed without guardrails, so that my explicit gesture wins, as it does everywhere else in the app

### Hand-cut Takes

21. As a DJ, I want to cut a window over any moment and get an ordinary Take, so that the detector missing a blend never means losing it
22. As a DJ, I want a hand-cut Take's kind and pair derived from the events by the survivor rule over the enclosing engagement, so that I point at moments and never fill in classification forms
23. As a DJ cutting inside a multi-deck stretch, I want to pick among the derived ordered-pair verdicts, so that ambiguity is a selection, not a guess
24. As a DJ, I want hand-cut Takes fully first-class — vectorizable, promotable, pinnable, counting toward Observed — so that how evidence was cut never limits what it's good for
25. As a DJ, I want a cut inside a still-unsettled engagement to wait for a verdict rather than guess, so that evidence is never fabricated
26. As a DJ, I want my cut's window bounds respected exactly, so that my slice is my slice

### Re-scan

27. As a DJ, I want an explicit re-scan of a Session with the current detector, so that improved detection reaches performances that predate it
28. As a DJ, I want re-scan verdicts as ghosts I accept one by one — never auto-materialized — so that retroactive detection happens under my eyes
29. As a DJ, I want re-scan to flag existing Takes the current detector would reject, visually only, so that I can judge them myself; deletion stays my act
30. As a DJ whose app crashed mid-blend, I want a re-scan of the orphaned partial Session to recover the Take, so that the crash concession of ADR 0020 is retired
31. As the developer tuning detection, I want to run candidate parameters over a real Session and see the verdict diff on the timeline, so that tuning has an instrument instead of a log dump

## Implementation Decisions

- **The recorder gains a persistence sink beside the in-memory rolling log** (which the live detector keeps reading unchanged): events batch into append-only chunks flushed every ~5s and on gate transitions/page-hide. Chunks are opaque JSON (optionally gzipped) — matching Takes' slice storage; binary formats rejected (ADR 0033).
- **Backend: a sessions table and a chunk table**, plus CRUD/append routes following the takes router pattern. A session row carries started-at and nullable ended-at. Takes gain a Session id (this is the "Take capture session" column the dig PRD planned) and an origin mark (detected | manual). Deleting a Session never touches Takes — Takes keep their own event slices and remain self-contained.
- **The >2-audible-decks suspension moves out of the recorder into the detector**: the log records all four Decks unconditionally; the phase-1 detector self-gates over >2-audible stretches. The audible-surface gate stays, but gate transitions write tenure markers (new capture event vocabulary) instead of silent holes.
- **The survivor-rule classifier is extracted from the detector** into a pure function callable over an arbitrary enclosing engagement, so detector verdicts and hand-cut classification are one definition. Hand-cut kind/pair are derived, never declared; unsettled engagements yield a pending refusal, not a guess. Kind is evidence; intent (wanting the other artifact kind) belongs at review/promotion.
- **Replay is a Session player on the shared live Decks** — the MixPlayer/Conductor scheduling pattern: reconstruct state at T (pure), load tracks, seed mixer/transport, fire events at their offsets. It claims the Audible surface as a machine tenure and yields to takeover (manual gesture ends replay, capture resumes). No OfflineAudioContext twin (ADR 0033).
- **Takes stay eagerly persisted; live detection is unchanged.** The timeline is a lens over persisted rows plus recomputable ghosts. Re-scan is explicit, suggest-only; accepting a ghost reuses the hand-cut creation path with a prefilled window.
- **Timeline and history coexist, deep-linked**: the history stays the cross-Session index; the timeline is the per-Session lens; Sessions get a modest list as the entry point.
- **Retention: keep forever, manual per-Session delete only.** No auto-pruning policy. The one exception (sessions 11): a 100%-silent row — a legacy artifact; the new activation path never creates one — is deleted automatically at end/recovery.
- **Session boundaries (sessions 11, amending the original no-heuristics decision)**: the row opens lazily on the first Master-audible Deck instant (loads, cueing, control setup, and tenure markers buffer as reconstruction context, never creating a row); ten continuous minutes with no Master-audible Deck close it (machine tenure counts as inactivity). The split flushes the idle tail into the old append-only log, resets all Session-scoped recorder/detector state, and stays dormant until performance resumes. Audibility is the one shared definition; the backend enforces the no-silent-rows rule with a Python port kept in lockstep.

## Testing Decisions

- Tests assert external behavior at module seams with real internals (ADR 0002): sessions persisted, verdicts derived, schedules produced — never recorder or detector internals.
- **Backend router seam** (TestClient + alembic-built in-memory SQLite; prior art: takes/transitions/sets router tests): session create/append/list/fetch round-trips; Take rows carrying session id and origin; Session delete leaving Takes intact.
- **Capture pure-module seam** (co-located vitest; prior art: detector and vectorizer suites): tenure markers emitted on gate transitions; no deck-count gating in the log; chunk batching/flush policy as a pure buffer; the extracted classifier agreeing with the detector on every existing detection scenario, plus hand-cut windows (mid-engagement cut, unsettled pending, multi-deck pair candidates); re-scan as a pure function from Session events to verdicts (new finds, confirmations, would-rejects).
- **Session lifecycle seam** (sessions 11): the ten-minute silence split as a pure fake-clock module (threshold, reset, once-per-silence-period latch); recorder coverage for audible-only activation, tenure-as-inactivity, detector reset at the boundary, and Take provenance across it; router coverage for silent-row deletion at end/recovery and the two-rows-after-split shape.
- **Session replay planner** (new pure module — the single new seam; prior art: the Set planner): state reconstruction at time T from init snapshots + events (playheads derived analytically between ticks), and the derived deck schedule, asserted without audio. Replay execution stays thin over existing scheduling machinery.
- The timeline view itself is prototype-gated and walkthrough-verified, not seam-tested.

## Out of Scope

- Audio recording of any kind (master-bus tap remains a possible future additive layer; ADR 0009's note stands)
- Automatic re-scan on detector upgrade; any dedupe machinery
- Auto-deletion of would-reject-flagged Takes
- ~~Session boundary heuristics (idle-split); the viewer collapses idle instead~~ (reversed by sessions 11: ten minutes of silence now split; the viewer still collapses intra-Session idle)
- Retention/pruning policy beyond manual delete
- Mining Played runs from Sessions directly (stays a Transition-history miner; noted as a future upgrade)
- Cross-kind promotion ("open this Cameo Take as a Transition draft") — intent-at-promotion is the designated home, deferred until wanted
- Capturing machine performances' event streams (tenure markers only)
- Changing Take review: raw replay is the Session audition medium, not the Take review medium (the transition-takes PRD's exclusion stands)

## Further Notes

- **Phase 0 — the timeline view is prototype-gated.** Before implementing the view proper, a throwaway prototype (built in a lane, reviewed by walkthrough) renders real persisted Sessions: deck lanes, audibility bands, idle collapse, tenure gaps, Take chips, ghost verdicts, scrub/cut interactions. The design graduates into the implementation issues only after review — the prototype may send us back to grilling. Prior art: the take-vectorization PRD's Phase-0 gate.
- Napkin math, for the record: events run ~2 MB/hour raw JSON (~10:1 gzippable); a year of heavy practice is tens of MB compressed. Size never justified binary formats or audio-vs-events trade-offs.
- Glossary (Session; amended Take, Cameo Take, Transition history) and ADR 0033 were written during the 2026-07-15 grilling session.

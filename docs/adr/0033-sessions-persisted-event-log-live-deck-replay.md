# Sessions: the whole performance event log persists; replay through the live decks

Status: accepted (grill 2026-07-15)

The "whole-session capture" ADR 0020 reserved as a separate future concept. The
always-on capture tap's rolling log now persists in full as a **Session** (glossary):
one per recorder lifetime, one capture clock, all four Decks unconditionally, streamed
to the backend in append-only JSON chunks (~5s flush). A Session timeline is the
scrubbable lens over a night of playing — Takes drawn in place, the detector's
rejected/missed verdicts renderable as ghosts, moments hand-cuttable into Takes —
complementing the Transition history (the cross-Session index; the two deep-link).

Core decisions:

- **Events, not audio.** A Session stores control/transport events only. Auditioning
  a moment **replays through the shared live Decks** (the MixPlayer/Conductor
  pattern): the Session player loads tracks, seeds state, fires events at their
  offsets. Fidelity is by construction — the same engine that made the sound —
  and replay yields to takeover exactly like the Conductor (manual gesture ends it,
  capture resumes), composing the rehearsal loop: scrub to last night's blend,
  replay in, exit differently, capture the new Take.
- **The >2-audible-decks suspension moves out of the recorder into the detector.**
  The log records everything; detectors self-gate. Old Sessions become re-analyzable
  by detectors that didn't exist when they were played (phase-2 multi-deck, Cameo).
- **The audible-surface gate stays at the Session level**, but non-performance
  stretches (editor auditions, Conductor playback, Session replay itself) leave
  **tenure markers** — the log records that a machine held the surface from X to Y,
  never what it played.
- **Takes stay eagerly persisted and self-contained.** Live detection is unchanged;
  each Take gains a Session id (provenance, not a dependency) and keeps its own
  event slice. **Sessions are prunable, Takes are forever** — deleting a Session
  costs its timeline, never an artifact's evidence.
- **Hand-cut Takes**: a manual window over the Session becomes an ordinary Take
  (`origin: manual`), first-class downstream (vectorization, promotion, pins,
  Observed). **Kind and pair are derived, never declared** — the same survivor-rule
  classifier the detector uses, applied to the engagement enclosing the cut (the
  whole log is available; window bounds don't constrain classification). Kind is
  evidence; wanting a different artifact kind is intent, expressed at
  review/promotion, not by relabeling. Unsettled engagements have no verdict yet.
- **Retroactive re-scans are explicit and suggest-only**: verdicts render as
  timeline ghosts; accepting one reuses the hand-cut path. No auto-materialization,
  no dedupe machinery, no auto-deletion (would-now-reject is a visual flag only).

## Considered options

- **Master-bus audio tap** (alone or alongside events) — deferred, not rejected on
  size (Opus is ~70 MB/h; events are ~2 MB/h raw JSON, ~10:1 gzippable): events are
  the spine regardless (timeline visuals, detection, vectorization all read events;
  audio is only a listening medium), and live-deck replay covers listening. A tap
  remains a purely additive later layer (ADR 0009's note still stands).
- **OfflineAudioContext rendering** for auditions — rejected: every deck feature
  would carry an offline-twin parity tax forever, and silent drift between the twins
  falsifies exactly the honesty this design exists for. Cost: replay commandeers the
  decks (accepted — review is a foreground activity; mid-set replay is allowed,
  guardrail-free, the human's gesture wins as everywhere else).
- **Takes as lazy views/suggestions over Sessions** — rejected: Set pins reference
  Take uuids (ADR 0023), Observed counts persisted rows, fresh-take chips need live
  detection; eager Takes change nothing downstream while the timeline adds
  observability on top.
- **Session boundary heuristics** (idle-split) — rejected: the viewer collapses idle;
  the stored Session stays a dumb container.
- **Binary event format** — rejected: post-compression savings are ~2× on tens of
  MB/year, paid for with schema machinery and the loss of the greppable tuning
  ground; Takes already store slices as opaque JSON.

## Consequences

- ADR 0020's "rolling log is ephemeral and never persisted" consequence is retired;
  its "crash loses the mid-blend Take" concession is too — a re-scan over the
  orphaned partial Session recovers it.
- The transition-takes PRD's exclusion of "Take playback as raw replay" is *not*
  reversed: Take review remains the vectorized draft in the editor; raw replay is
  the Session audition medium.
- The Audible surface gains a tenure holder (Session replay) and the capture event
  vocabulary gains tenure markers; the recorder loses its deck-count gate.
- `dig.md`'s planned "Take capture session" UUID column is the Session id.

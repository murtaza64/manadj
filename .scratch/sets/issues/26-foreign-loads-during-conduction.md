# 26 — Foreign deck loads during conduction: reload war, no takeover

(Renumbered from 24, 2026-07-05 — parallel filing collided with 24-live-replan.)

Status: needs-triage

## Parent

.scratch/sets/PRD.md (found during sets 21 code review, 2026-07-05)

## Problem

While the Conductor is conducting, a user-initiated Load onto a deck it occupies is neither a takeover nor blocked — it starts a reload war:

- `Conductor.watchEngine` deliberately treats trackId/loadState changes as load-flow ("a Load, not a gesture") and never fires takeover.
- `Conductor.ensureDeckTrack` sees the wrong track but `loadRequested[deck]` still equals the desired id, so it never re-requests — the deck sticks on the user's track while the plan calls for another; behavior degrades unpredictably.

Reachable from every browse surface while a set plays: the Performance/library views' load buttons, and the Transition editor's embedded library / arrow keys / swap-decks (a mounted-but-silent editor over a playing Conductor is the normal case since sets 21).

Sets 21 covered only the editor's artifact-open paths (`openPair`/`openTake` claim audibility before loading, so the Conductor stands down first). Plain loads are still exposed, in the editor and everywhere else.

## Options

- Treat a foreign load (trackId change not initiated via the Conductor's own `loadRequested`) as takeover — the decks keep playing as they are, per the existing takeover rule. Probably the consistent answer: a Load is a manual deck gesture in spirit.
- Or: gate/refuse Load affordances on a conducted deck (UI-level), which fights the "any view visualizes the set" philosophy.

## Notes

- Same class of gesture as sets 21's `openPair` rationale ("loading the shared Decks commandeers them"), applied app-wide.
- Touches `Conductor.ts` (lane setlist history); coordinate with in-flight conductor work.

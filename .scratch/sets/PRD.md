# PRD: Sets

Status: ready-for-agent

## Problem Statement

The Transition library, Takes, and Linked pairs now hold real knowledge about what mixes well into what — but that knowledge is stranded at the pair level. There is no way to assemble it into a plan for an actual DJ set: no way to hear a sequence of tracks played through their saved Transitions, no help choosing what to add to a sequence, and no view of which handovers in a planned sequence have never been practiced.

## Solution

A **Set**: an ordered sequence of Tracks whose adjacencies each pin a saved Transition, a Take, or nothing (unresolved). Sets live in the sidebar as siblings of Playlists; selecting one replaces the track table with a Set UI showing the adjacency ladder, pin states, and evidence badges. The **Conductor** plays a Set end-to-end on the two shared Decks and Mixer — visible in the Performance view — ping-ponging tracks and executing pinned Transitions, hard-cutting at unresolved adjacencies. Suggestions reuse Follow-mode tiering to propose tracks to append or insert. Unpracticed adjacencies (no Transition, no Take for the pair) are flagged as the rehearsal to-do list.

All domain vocabulary is defined in `CONTEXT.md` (Set, Set playback, Conductor, Tempo policy, Set tempo, Tempo return, Unresolved, Unpracticed) — updated 2026-07-05 during the design grilling. The former "Mix" concept is renamed to Set.

## User Stories

1. As a DJ, I want to create an empty Set and add Tracks to it in order, so that I can plan a set from scratch.
2. As a DJ, I want to create a Set from an existing Playlist (a one-time copy of its Play order), so that I can turn a curated playlist into a performable plan.
3. As a DJ, I want Sets to appear in the sidebar alongside my Playlists, so that both artifact kinds are browsable in one place.
4. As a DJ, I want selecting a Set to show a Set UI in place of the track table, so that I see the adjacency ladder rather than a flat track list.
5. As a DJ, I want each adjacency to show its pin state (Transition, Take, or unresolved), so that I know exactly what will play at each handover.
6. As a DJ, I want auto-fill to propose a saved Transition for each adjacency that has one (favorite first), so that building a Set from my Transition library takes one click per handover.
7. As a DJ, I want to manually pin a specific Transition when a pair has several, so that the Set plays the exact move I intend.
8. As a DJ, I want to manually pin an unpromoted Take when no saved Transition exists, so that a once-recorded handover is usable in the Set without promoting it.
9. As a DJ, I want auto-fill to never pin a Take for me, so that unreviewed material only enters a Set by my explicit choice.
10. As a DJ, I want promoting a Take to re-point every Set pin from that Take to the resulting Transition, so that promotion upgrades my Sets automatically.
11. As a DJ, I want pins to be stable — saving new Transitions for a pair never changes an existing pin — so that Set playback is deterministic.
12. As a DJ, I want to play a Set end-to-end with saved Transitions executed automatically, so that I can audition the whole plan hands-free.
13. As a DJ, I want Set playback to run on the two shared Decks and Mixer, so that the Performance view visualizes the set as it plays.
14. As a DJ, I want unresolved adjacencies to hard-cut (outgoing Track to its end, incoming from its Main cue), so that playback never stalls at a gap.
15. As a DJ, I want the first Track to start at its beginning and playback to stop after the last Track ends, so that a Set has sensible boundaries. *(Revised 2026-07-05 during the 03 review: was "at its Main cue" — the Main cue is a performance marker, not a set boundary.)*
16. As a DJ, I want to start Set playback from any position in the ladder, so that I can audition one section without replaying the whole set.
17. As a DJ, I want any manual deck or mixer gesture to stop the Conductor entirely while the Decks keep playing as they are, so that I can grab the controls and continue the set live.
18. As a DJ, I want Conductor-driven playback to be invisible to Take capture, so that machine performances never pollute my Transition history.
19. As a DJ, I want capture to resume the moment I take over, so that my live continuation can produce pinnable Takes.
20. As a DJ, I want a per-Set Tempo policy — Riding or Fixed — so that an open-format set can breathe while a dnb set holds one tempo.
21. As a DJ, I want Riding playback to ease each incoming Track back to its native tempo after the window (Tempo return), so that transitions authored at native BPM play as authored.
22. As a DJ, I want a validation flag when a solo stretch is too short for the Tempo return to complete, so that insufficient runway is visible before it bites.
23. As a DJ, I want a Fixed-policy Set to play everything at an explicit, editable Set tempo (defaulted from the first Track's BPM), so that the whole set locks to one BPM.
24. As a DJ, I want each Deck's Key Lock setting respected during Set playback, so that pitched tracks behave the way my decks are configured.
25. As a DJ, I want adjacencies flagged Unpracticed when the ordered pair has no saved Transition and no Take, so that I have a rehearsal to-do list.
26. As a DJ, I want each adjacency to show its pair's evidence (how many saved Transitions and Takes exist), so that I can distinguish "unpinned" from "never mixed".
27. As a DJ, I want to click through from an adjacency to the Transition editor loaded with that pair, so that I can practice or edit the handover directly.
28. As a DJ, I want suggested Tracks to append after the last Track, ranked by Follow-mode tiering (known tier first), so that extending a Set leans on what I've proven.
29. As a DJ, I want suggested Tracks to insert between two adjacent Tracks, ranked by the weaker of the two edges, so that an insert is judged by its worst handover.
30. As a DJ, I want suggestions to exclude Tracks already in the Set, so that no Track is proposed twice.
31. As a DJ, I want a Track to appear at most once in a Set, so that "is this Track in the Set" is always unambiguous.
32. As a DJ, I want reordering to preserve pins as Dormant pins (restored automatically when the pair becomes adjacent again in this Set), so that rearranging is never destructive.
33. As a DJ, I want a pin whose Transition or Take was deleted to become unresolved rather than break, so that library cleanup never corrupts a Set.
34. As a DJ, I want a Set containing an Archived Track to be flagged rather than silently altered, so that curation verdicts and set plans stay reconciled by me.
35. As a DJ, I want to name and reorder my Sets in the sidebar, so that multiple plans stay organized.
36. As a DJ, I want to export a Set's track order as a new Playlist, so that the order can reach external libraries through the existing Export path.
37. As a DJ, I want to delete a Set without affecting any Transition, Take, or Track, so that a Set is only ever a plan over the library, never an owner of it.
38. As a DJ, I want the Set view's overview ladder to recompute live while I drag a track, showing which adjacencies will restore a Dormant pin, auto-fill, or fall unresolved, so that I see the consequences of a reorder before dropping.
39. As a DJ, I want clicking an adjacency to open the Transition editor for that pair (pinned Transition selected, Take pin in review, unresolved as a blank sketch) while the browse surface below stays put, so that I can walk a set and fine-tune its handovers without losing my place.
40. As a DJ, I want a play button on each Set row that seeks the Conductor to that track's planned entry and plays, so that I can resume Set playback from anywhere.
41. As a DJ, I want clicking the overview ladder to seek within the mix, with a visible playhead in the ladder and the active row highlighted, so that auditioning any moment of the set is one click.
42. As a DJ, I want a follow-playback toggle (on when playback starts, disengaged by manual pan/scroll, re-engaged by seeking), so that the ladder and list converge on the playhead unless I'm deliberately browsing elsewhere.

## Implementation Decisions

- **Set is a first-class artifact**, not a decoration on Playlist. Renames the glossary's former "Mix" concept. A Playlist's identity is hand-curated order for Export; a Set's identity is its adjacencies and what they pin.
- **Adjacency pin** is an explicit, nullable, stable reference: a saved Transition (by uuid), a Take (by uuid), or nothing (unresolved). Pins never resolve at query time; favoriting or saving new Transitions never changes a pin.
- **Auto-fill** proposes Transitions only (favorite first, else the sole Transition); Takes are pinned manually only. Take promotion rewrites all Set pins referencing that Take to the new Transition uuid, at promotion time (the Take model already records its promoted Transition).
- **Take pins play their idealized vectorization computed at play time** using the existing vectorizer (the same result promotion would produce) — no snapshot into the Set, no auto-promotion. Vectorizer improvements flow through automatically.
- **Set playback structure is fully derived from pins**: a pinned Transition's start position is in the outgoing Track's own time (Sketch origin invariant), so each Track's solo stretch and every handover instant follow from the pins alone. No new anchors.
- **Unresolved adjacency = hard cut**: outgoing plays to its end, incoming starts at its Main cue. The first Track starts at its BEGINNING (revised 2026-07-05, 03 review — a set opens with the whole opening track; hard-cut incomings still enter at their Main cue); playback stops after the last Track.
- **Conductor, not a new Audible surface**: Set playback is an automation driver on the existing performance surface, loading Decks, starting transports, and moving Mixer controls per the pins. Tracks ping-pong across Deck A and Deck B. Any manual deck/mixer gesture stops the Conductor entirely (per-control takeover deferred); the Decks keep playing and the user is live. Conductor-driven playback is invisible to Handover detection; capture resumes at takeover.
- **Tempo policy is per-Set**, two values. *Riding*: each incoming Track eases back to native tempo after the window — the Tempo return, a tunable-heuristic ramp that must complete before the next window (insufficient runway is a validation flag; the ramp clamps faster rather than staying incomplete). *Fixed*: one explicit Set tempo (BPM, defaulted from the first Track's native BPM); every Track pitched to it, pinned Transitions play rate-scaled as a whole; a Transition's tempo-match flag is moot. Tempo-matched Transitions scale cleanly under a global rate: both decks stay matched and automation stretches uniformly.
- **Key Lock**: the Conductor inherits each Deck's sticky Key Lock setting; no Set-level override.
- **Unpracticed vs Unresolved are orthogonal per-adjacency states**: Unresolved = nothing pinned (playback hard-cuts); Unpracticed = the ordered pair has no saved Transition and no Take. The Set UI badges both distinctly and shows per-adjacency evidence counts with click-through to the Transition editor for that pair.
- **Suggestions reuse Follow-mode tiering** (known tier: favorited Transition > Linked > unfavorited Transition; then Compatible key tiers), honoring Transition directionality. Append ranks candidates out of the last Track. Insert scores both edges (out of the predecessor, into the successor) and ranks by the weaker edge, tie-breaking by the stronger. Candidates already in the Set are excluded.
- **A Track appears at most once in a Set** (same invariant as Playlist). Reordering or removing Tracks breaks the affected adjacencies, but never destroys pins: each broken pin becomes a **Dormant pin** — a per-Set, per-ordered-pair memory restored automatically when that pair becomes adjacent again in that Set (including manually-pinned Takes; the original manual act is being honored). Strictly per-Set: other Sets get ordinary auto-fill. No discard warning exists — there is nothing destructive to warn about. During a drag, the overview recomputes optimistically for the hypothetical order, rendering each affected adjacency's future: will-restore (Dormant pin), auto-fillable (library Transition exists), or unresolved.
- **Dangling references degrade to unresolved**: deleting a pinned Transition or Take turns the pin unresolved. Archiving a Track that belongs to a Set flags the Set rather than removing the Track.
- **Sets are sidebar siblings of Playlists**; selecting a Set swaps the main browse pane to the Set UI (adjacency ladder). Because the browse surface is embedded in the Performance view, the Set UI is available there without extra work, and Set playback is visualized by the existing deck waveforms and mixer.
- **Persistence**: new Set and Set-entry tables (ordered entries; pin kind + uuid columns on the entry for the adjacency it heads), Alembic migration per repo convention. Persistence follows the client-authoritative pattern established for Transitions (ADR 0011): the client owns Set state and replaces it via the API; the backend router provides CRUD plus the promotion re-pointing hook.
- **Escape hatch to Export**: "create Playlist from Set" copies the track order into a new ordinary Playlist; Sets themselves never Export (external libraries have no transition concept).
- **The Conductor is a thin driver over a new pure planner module**: `plan(Set, pins, track facts) → deterministic playback plan` (deck assignments, entry/exit instants, rates, Tempo returns, runway flags, hard cuts). All playback semantics live in the planner; the runtime driver only schedules the plan onto the shared deck engines, in the mold of the existing two-track mix player.
- **Conductor transport**: play/pause/seek are Conductor controls, not takeover triggers — the takeover rule applies to deck/mixer gestures only. Seek is plan evaluation at a mix-time instant (active tracks, deck positions, lane values mid-window, tempo state per policy), legal mid-Transition and while paused. Per-row play buttons seek to that track's planned entry and play; clicking the overview ladder seeks. The ladder and list are DECOUPLED surfaces (revised 2026-07-05: the original mutual scroll-pin breaks on one-screen Sets and its invariant is unkeepable): the ladder pans/zooms freely (vertical wheel = zoom, waveform convention; default framing fits the whole set), and the surfaces converge on EVENTS only — a seek centers the playhead in the ladder (if off-viewport) and scrolls the active row into view; under follow-playback the ladder auto-scrolls paged (DAW-style) and the list follows at track-change boundaries. Follow: on at playback start, disengaged by manual pan/scroll (never by zoom), re-engaged by seeking.
- **Transition lanes address roles, not physical Decks**: `faderA`/`faderB` etc. mean outgoing/incoming. The Conductor maps roles onto Decks per its ping-pong parity (swapping channels on odd adjacencies); the Transition editor always presents outgoing-as-A. Artifacts stay deck-agnostic.
- **The Set view lives on the shared browse surface** (the pane the Performance view and Transition editor both embed). Clicking an adjacency loads the pair (outgoing→A, incoming→B) and switches the top panel to the Transition editor — pinned Transition selected, Take pin opens review, unresolved opens a blank sketch — while the browse surface below does not remount or move; walking a set's handovers stays inside editor mode. Set-view state (selected Set, scroll progress) lives in a store, not component state, since each mode mounts its own browse instance.

## Testing Decisions

- Tests exercise external behavior at seams, never implementation details.
- **Set planner (new pure module, frontend)** — the single new seam. Every playback semantic is asserted here without audio: ping-pong deck assignment, handover instants derived from pins, hard-cut boundaries, Main-cue starts, Riding ramps and runway flags, Fixed-tempo global rate scaling, Take-pin vectorization delegation. Prior art: the pure vitest suites for the mix model (`frontend/src/editor/mixModel.test.ts`), vectorizer (`frontend/src/capture/vectorize.test.ts`), and follow model (`frontend/src/follow/model.test.ts`).
- **Suggestion ranking** — new pure functions beside the existing Follow model, tested in the existing suite's style (`frontend/src/follow/model.test.ts`): append tiering, weaker-edge insert combining, direction handling, in-Set exclusion.
- **Backend Sets router** — CRUD, pin persistence, dangling-pin degradation, and promotion re-pointing (asserted at the take-promotion endpoint), tested at the router level. Prior art: `tests/test_takes_router.py`.
- The runtime Conductor driver, Set UI components, and sidebar integration ride on these seams without dedicated suites.

## Out of Scope

- **Practice mode**: pausing at unresolved adjacencies to hand the mix to the user and capture a Take for pinning. Noted as a natural follow-on; the capture-resumes-at-takeover rule is its foundation.
- **Per-control takeover** (grab one fader, autopilot keeps the rest); takeover is all-or-nothing for now.
- **Whole-set generation or optimization**: energy arcs, tempo trajectories, "plan me a set" graph walks over the Transition library. Append/insert suggestion is the tracer bullet.
- **Per-section tempo progression** within a Set; one Tempo policy (and one Set tempo) per Set.
- **Offline audio render/export** of a Set to an audio file.
- **Exporting Sets to external libraries** (they have no transition concept); only the track-order-to-Playlist escape hatch.
- **Track repetition** within a Set.
- **Takes in discovery**: Follow mode's known tier still excludes Takes; pinning is the only non-audit use of an unpromoted Take.

## Further Notes

- `CONTEXT.md` was updated during the design session: Set (replacing Mix), Set playback, Conductor, Tempo policy, Set tempo, Tempo return, Unresolved, Unpracticed; Take's entry now records the pinning exception.
- Two ADRs should be written during implementation, both meeting the hard-to-reverse / surprising / real-trade-off bar:
  1. *Set adjacencies may pin unpromoted Takes* — contradicts the prior "Takes are audit data" stance; alternatives considered were auto-promotion on pin and snapshotting vectorized data into the adjacency.
  2. *Set playback is a Conductor, not an Audible surface* — a reader familiar with the audible-surface arbiter (ADR 0013) will expect a third surface; the takeover and capture-invisibility rules are the rationale.
- Tunable heuristics (Tempo return ramp speed, clamp behavior) are settings, not model; defaults chosen during implementation.

## Comments

**2026-07-05 — grilling round 2 (post-prototype).** Decisions folded into the body above: (1) reorder previews live in the overview ladder during drag; (2) pin discard-on-reorder overturned — pins go Dormant per ordered pair per Set, auto-restoring (new glossary term); (3) adjacency click-through to the Transition editor over the stationary shared browse surface; (4) Transition lanes are role-addressed, not deck-addressed — Conductor swaps channels per ping-pong parity; (5) Conductor transport (play/pause/seek + follow mode) is not a takeover trigger; ladder click = seek, per-row play buttons. Set view is a planning/practice surface, not a performance tool — no seek guard needed. UI prototype (variant D, "list + follow minimap") lives on the sets lane, change qpzwslkl; verdict notes pending in the prototype dir.

**2026-07-05 — 03/04 review feedback (human click-through).** (1) First
track starts from its beginning, not its Main cue — decision revised above,
planner fixed in the parked stack (amended into vykmvyym). (2) The ladder's
hard scroll-pinning breaks when a Set fits one screen (no list scroll ⇒
zoomed ladder unreachable); band-aid in the stack (zoom drops to 1 when the
list doesn't scroll); a redesign — free ladder viewport + zoom, viewport
highlighted in the tracklist — is being grilled as a candidate ticket.
(3) On-screen deck/mixer controls not moving during conducted playback is
ADR 0022 by design (automation overlay never touches base state); filed as
issue 15 (needs-triage; renumbered from 13 after a parallel-filing collision). (4) Overlapping windows edge (B→C window opens
before A→B closes): the shared deck gets an instantaneous jump, aggravated
by load delays — needs visual surfacing (ladder) and graceful handling
(e.g. early fade-out to free the deck ~5s for loading); in the same grill.

**2026-07-05 — grilling round 3 (rehearsal loop).** Assessed the "notice gap → mix live → Take appears → pin" story: capture machinery and evidence model already cover it; two connecting gestures were missing. Decisions: a practice affordance per adjacency (loads outgoing→A/incoming→B in the Performance view, runway/hot-cue/Main-cue positioning, re-press re-cues) distinct from issue 09's editor click-through; fresh Takes invalidate the takes query and surface a transient "new take — pin?" chip on the matching adjacency (latest attempt; never auto-pinned). Filed as issue 13; Conductor practice-mode (pause at unresolved) stays deferred.

**2026-07-05 — grill: free ladder + Grace fade (post-03/04 review).**
(1) Ladder↔list scroll-pin retired — decoupled surfaces with event-driven
convergence (seek; track changes under follow); ladder gains free pan/zoom
(vertical wheel, cursor-anchored — playhead-anchored under follow), default
framing fits the whole set; folded into the rewritten issue 05. (2) Window
collisions (B→C opening before A→B closes, or before a hard-cut outgoing
ends) get a **Grace fade**: planner-level truncation of the earlier
outgoing (default 5s load headroom + ~2s synthesized fade, both tunable
settings), never shifting authored windows; degenerate pileups become
validation flags. Conductor load handling: never stall while music plays
(late deck joins at plan position), never skip while silent (clock holds);
next-entry buffer prefetch into the decode cache. Filed as issue 14.

**2026-07-05 — tracker hygiene.** Two sessions filed an issue 13 in
parallel (rehearsal loop / visualize-conductor-automation); the
visualization issue is renumbered to 15.

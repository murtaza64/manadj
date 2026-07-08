# PRD: Cameos — doubles and teases where the host survives

Status: ready-for-agent

Parent: grill of `.scratch/sets/issues/29-b-interlude-doubles.md` (2026-07-06). Glossary updated in `CONTEXT.md` in the same grill (docs change `doubles: grill (docs)`); this PRD uses that vocabulary throughout.

## Problem Statement

I perform doubles and teases: bring a second track in over the one playing — a double drop, an acapella over an instrumental, a dnb tease — let it ride, then take it back out. The original track never stops being *the* track. manadj cannot express this: a Transition means "B is next" (a Set adjacency built on it advances the set — semantically wrong even when sonically faked), and Handover detection explicitly discards engagements where the outgoing survives. Performing a double today yields no plannable artifact, no captured evidence, nothing pinnable in a Set.

## Solution

A new first-class persisted artifact, the **Cameo**: a guest Track's bounded appearance inside a host Track's play — the guest becomes audible and silent entirely within the host's play, and the host remains current. The **survivor rule** is the boundary with Transition: whoever remains current classifies the move (a double you continue from is a Transition with a double-drop-shaped window; a double where the original rides on is a Cameo). Cameos get full parallel treatment: authored in the same Transition editor (kind-aware), captured by the same detector (Guest engagement — the second verdict of the classification it already performs — emitting Cameo Takes), pinned on Set entries (not adjacencies), performed by the Conductor (guest borrows the opposite Deck and returns it), and counted in discovery's Known tier.

## User Stories

Authoring:
1. I want to author a Cameo between two loaded Tracks in the Transition editor, so that I can plan a double before performing it.
2. I want the Cameo's two-edged window anchored on the host's timeline, so that the guest's entry *and* exit are part of the artifact.
3. I want to Slide the guest and give it a silent lead gap, so that alignment works exactly as it does for Transitions.
4. I want an optional tempo-match, always guest→host, so that the guest pitches to the track that stays current (no Tempo return — the host never leaves its rate).
5. I want automation lanes addressing host/guest roles, so that the move plays correctly whichever physical Deck hosts it.
6. I want Jump events on the guest, so that I can double a buildup or loop the guest.
7. I want Jump events on the host too, so that I can extend or repeat a host section (loop the breakdown) to fit the double — timeline = the host's elapsed play; the host never slides but may Jump.
8. I want several saved Cameos for one (host, guest) pair, so that different teases of the same pair coexist — alongside any Transitions for that pair.
9. I want a self-Cameo (the same Track as host and guest), so that I can plan a double against itself.
10. I want Cameo templates (kind-specific, same recipe shape), so that a practiced tease stamps onto new pairs.
11. I want editor auditions of Cameos through the shared Decks, invisible to capture, so that reviewing isn't recording.
12. I want one undo history per pair spanning both kinds, so that editing feels like one session.

Sets:
13. I want to pin a Cameo on a Set entry (never an adjacency), so that a guest appearance belongs to its host position.
14. I want multiple Cameo pins on one entry, so that a long host can take guests at different points.
15. I want Cameo pins to survive reordering untouched, so that ornaments don't fight the spine.
16. I want a removed host Track's Cameo pins to go Dormant and restore when it returns, so that removal is non-destructive.
17. I want validation flags when a guest window overlaps another window or a neighboring Transition's load point, so that I see collisions at plan time, not play time.
18. I want the Overview ladder to render a subordinate guest clip on the opposite Deck lane inside the host's span — no stair step — so that the staircase stays adjacency-shaped.
19. I want to pin a Cameo Take manually (never auto-fill), so that an unreviewed capture can still play in a Set.
20. I want a Cameo's guest to never appear in the Set order, so that the spine stays the sequence of current tracks.

Playback:
21. I want the Conductor to perform Cameo pins — guest in and out on the opposite Deck — so that planned doubles play themselves.
22. I want ping-pong parity to ignore Cameos, so that "which Deck loads next" never depends on ornaments.
23. I want a guest colliding with the next adjacency to Grace-fade out early — the adjacency always wins — so that playback never stalls or delays the spine.
24. I want the plan to simulate host Jumps (elapsed time, downstream anchors resolving at the final pass), so that an extended host section shifts everything after it correctly.
25. I want Pickup to light mid-Cameo (two audible Decks aligned with a pinned Cameo within tolerance), so that I can hand a live double back to the Conductor.
26. I want Live re-plan to treat a sounding Cameo like a sounding Transition (geometry deferred, lane values live), so that editing under the playhead stays the riding-the-mix idiom.

Capture:
27. I want the detector to classify every engagement by survivor at settle time, so that the same event stream yields a Take or a Cameo Take with no new detection machinery.
28. I want teases and doubles where my track rides on to emit Cameo Takes automatically, so that performing a double finally leaves evidence.
29. I want Cameo Takes reviewed in the editor via Vectorization (two-edged window, Jumps on both roles), so that capture-to-artifact works like it does for Transitions.
30. I want promoting a Cameo Take to save a Cameo and re-point Set pins, so that promotion semantics stay uniform.
31. I want the Transition history to log both kinds grouped by engagement, so that "what did I actually mix" includes my doubles.
32. I want every Take and Cameo Take to carry its engagement, so that a triple is discoverable as a first-class group of its pairs, not timestamp inference.

Discovery:
33. I want to Favorite a Cameo, so that a proven tease ranks in discovery.
34. I want Cameo-connected pairs in the Known tier (strength: favorited Transition, favorited Cameo, Linked, unfavorited Transition, unfavorited Cameo — provisional), so that confirmed guest evidence counts.
35. I want Follow to surface Tracks with a saved Cameo hosted by the playing Track, so that I can pull up a guest mid-set.
36. I want a Cameo library ("what guests over this / what hosts this"), directional host→guest, distinct from the Transition library, so that "mixes into" stays uncontaminated.
37. I want Unpracticed to ignore Cameos and Cameo Takes, so that teasing B over A never masks that I've not rehearsed the A→B adjacency.

## Implementation Decisions

- New persisted artifact + table mirroring the Transition storage pattern (ADR 0011): host/guest Track refs, pair-scoped uuid, name, favorite, opaque client-authoritative data payload carrying window, guest alignment, tempo-match, role-addressed lanes, and Jump events for both roles. API mirrors the transitions router: kebab-case collection + wholesale pair-replace endpoint.
- Survivor rule is the model boundary, applied identically at authoring (which artifact you're editing), capture (which verdict the engagement settles to), and Set semantics (the guest never enters the Set order).
- Set entries gain a list of Cameo pins (kinds: cameo, cameo-take) alongside the existing adjacency pin; always manual — no Unresolved state, no auto-fill, by design. Dormancy extends keyed on host Track per Set.
- Takes storage gains a kind (handover | guest) and an engagement identity stamped on every capture from one engagement; the history groups by it. A 2-deck engagement emits exactly one artifact (the survivor rule makes the verdicts exclusive per pair).
- Detection is one engagement tracker with two settle verdicts; thresholds/settle horizons remain tunable heuristics outside the definition. Conductor playback and editor auditions stay invisible to capture.
- Vectorization gains a Cameo mode (same per-lane idealization; two-edged window; Jumps preserved on both roles).
- One editor, kind-aware: Sketch origin holds with host as the outgoing role (host-as-A presentation, host never slides, runs the full timeline width, may Jump inside the window). Templates are kind-specific and never cross-apply.
- Planner/Conductor: guest borrows the opposite Deck, parity is a pure function of adjacency count, adjacency-wins Grace fade for guest collisions, host-Jump simulation with downstream host-timeline anchors resolving at the final pass, Pickup and Live re-plan extended as above.
- Discovery: Known-tier definition, strength ordering, Favorite on Cameos, Follow's known candidates gain hosted-guests. Linked's "goes well together" union gains favorited Cameos.
- Write Q6's collision rule as deck-pool-of-2 arithmetic (concurrent roles ≤ deck pool), so the future multi-deck extension relaxes a validation rather than repeals a semantic.

## Testing Decisions

External behavior only, at existing seams:

- **Backend router seam** (ADR 0002 style: TestClient + alembic-built in-memory SQLite; prior art: the transitions, sets, takes router tests and the take-promotion-repoints-pins test): cameos CRUD/pair-replace, Cameo pins in set entries, dormant Cameo pins on host removal/return, engagement grouping on takes, Cameo Take promotion re-pointing pins.
- **Capture module seam** (co-located vitest; prior art: existing capture tests): survivor classification — one event stream, both verdicts by who survives; guest-engagement window bounds; cross-cut folding into one Cameo Take; two engagements of the same pair yielding two Cameo Takes; Cameo vectorization mode.
- **Planner seam** (co-located vitest; prior art: existing planner/replan tests): guest deck borrowing, parity indifference to Cameo count, adjacency-wins Grace fade, host-Jump elapsed-time simulation with final-pass anchor resolution, validation flags.
- Editor and ladder UI get no dedicated new test surface, matching current practice.

## Out of Scope

- **Multi-deck (>2)**: concurrent Cameos over one host, triples as planned artifacts, co-scheduled composites (double-out-to-C — the Cameo exit time-locked to a Transition window). Sketch preserved for that future grill: capture already scales pairwise (engagement grouping is the capture-side half of the needed construct); the Set spine survives as-is; Q6's collision rule generalizes to deck-pool allocation; the one new construct is a grouping that time-locks pairwise artifacts to a shared clock, mirroring engagement grouping. No n-ary mega-Transition.
- Cameo auto-fill / Unresolved-for-Cameos — permanently out by design, not deferred.
- Outgoing-side Jumps in Transitions — still deferred; if admitted later, restate the invariant as elapsed-time, exactly as the Cameo already does.
- Practice mode, per-control takeover — existing deferrals unchanged.

## Further Notes

- Naming: "double" and "tease" are moves, not artifacts — either artifact kind can carry them (survivor rule). Avoid as artifact names; "interlude" and "overlay" also rejected.
- 2-deck coverage was swept exhaustively in the grill: every two-track engagement lands on exactly one of Cameo / Transition / non-pairing (single-deck tools), with cross-cut folds and the settle horizon as the only heuristics.
- Ticket `.scratch/sets/issues/29-b-interlude-doubles.md` is the pointer from the sets tracker; flipped when this PRD published.

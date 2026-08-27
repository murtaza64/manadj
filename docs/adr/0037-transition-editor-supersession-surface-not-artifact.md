# 0037 — Transition-editor supersession: unify the surface, not the artifact

Date: 2026-08-27
Status: accepted

## Decision

The Routine editor becomes the single mix-editing surface — for Routines,
Transitions, and Cameos alike. The **artifacts stay distinct**: Transition
(ordered pair, seconds-anchored window, context-free), Cameo (host/guest),
Routine (n ≥ 3 cast slots, beat-domain interior). ADR 0035's boundary — "a
2-cast routine IS a Transition; storing one as a Routine is forbidden" — is
reaffirmed, not repealed.

A pair artifact presents on the unified surface as two slots: slot 0 =
outgoing (or host), slot 1 = incoming (or guest). The Transition editor
(TransitionEditor/DawTimeline/MixPlayer) is retired once the unified surface
covers its inventory and every entry point is rewired.

## Why

- Transition is the most load-bearing artifact in the model: the Transition
  library, discovery's Known tier, Linked, favorite-first auto-resolution,
  Set pin anchoring, templates, and Cameos-as-siblings all consume it.
  Migrating storage to 2-cast Routines rewrites all of that for zero
  user-visible gain.
- The Routine editor's slot model already generalizes the Transition's
  anatomy (the glossary says so by construction), and by the 2026-08 wave it
  leads the pair editor on undo, holds, per-slot metric ladders, audition
  margins, and play/pause events.
- Two editors means two players, two timelines, two waveform pipelines, and
  every new editing affordance built twice (outgoing jumps landed in the pair
  editor the same week trim landed in the routine editor).

## Working representation (resolved in the same session)

Pair artifacts are **translated at the boundary**, not given their own algebra
inside the editor: on load, a Transition projects into slot form (slot 0 =
outgoing anchored at window start; slot 1 entry offset = the incoming's entry
alignment; lanes rebased onto the beat-domain clock via the outgoing's
Beatgrid). On save it projects back to the seconds-anchored artifact.
Two invariants:

- **Untouched fields round-trip losslessly** — save re-derives only what was
  edited; seconds↔beats quantization never drifts an unedited window.
- **Gridless tracks degrade, don't block**: a pair with a missing Beatgrid
  edits in a degraded seconds mode rather than being locked out.

Crop-vs-stretch collapses: beat-domain lane points crop naturally on window
resize; stretch survives only as an explicit lane-scaling gesture if wanted.

## Navigation (resolved in the same session)

There is no "loaded pair" on the unified surface — slots replaced deck-role
A/B — so navigation cannot lean on deck identity. One **context-aware picker**
is the surface's navigation system, absorbing the EvidenceSwitcher's jobs:

- **Scoped cycling**: within the current artifact's move (the ordered pair,
  or the cast), cycle siblings — Transitions, Takes, Routines, Routine Takes,
  candidates — with favorite/rename/delete as picker affordances for any kind.
- **Fast pair-finding**: quick UX to name two tracks and land on that pair's
  artifact set.
- **Smart first-open surfacing**: entering the editor cold reads live deck
  state — offer Transitions between pairs of loaded Tracks AND Routines whose
  cast intersects the loaded Tracks.

Open item for the picker design round: extending Favorite ★ to Routines
(today it exists on Transitions/Cameos only).

## Pair synthesis flow (resolved in the same session)

Creating from scratch lives in the picker: cold open focuses search; two
track query chips (typeahead, Enter/Enter) with a ⇄ direction flip turn the
picker into that ordered pair's **move page** — Transitions (favorite-first),
Takes, Cameos, Routines-through-the-pair, and an always-present
`+ New Transition A → B`. A single chip yields the "everything out of / into /
over this Track" page (track scouting). New blank pair drafts seed the window
at the outgoing's outro (~last 32 beats, incoming grid-aligned); live deck
state may override the seed when decks are playing. Persistence doctrine:
artifact exists → edits autosave; blank/review drafts persist nothing until
Promote/first edit (a draft you only auditioned leaves no trace; accepted
loss on crash).

## Review posture (resolved in the same session)

**Draft everywhere**: opening any unpromoted evidence — Take, Cameo Take,
Routine Take, or miner candidate — opens an editable, auditionable,
discardable review draft. **Promote is always the explicit persisting act.**
This reverses #170's confirm-and-promote-on-open for ⧉ candidates (browsing a
candidate must not mint a ◆ Routine); confirming a candidate into a Routine
Take remains a distinct human act per the suggestion-first doctrine.

## Set context (resolved in the same session)

Pin-follow ports whole, generalized by kind: opening the surface from any Set
pin carries the adjacency/entry context; picker cycling within that move
live-rewrites the pin kind-appropriately; Take promotion re-points Set pins
as today. Set context is **sticky to the move, not the surface**: navigating
the picker to a different pair/cast disarms pin-follow (visible in the UI);
cycling within the move keeps it.

## Templates (resolved in the same session)

**Dropped entirely** — router, storage, and UI deleted with the pair editor;
the glossary term is retired. Unused in practice; its anchor-resolution
machinery was the largest remaining consumer of the pair window algebra. May
return later as a Routine-native recipe concept if missed.

## MIDI (resolved in the same session)

**Deferred**: the pair editor's controller depth (hot-cue pads, beatjump,
jog, LED transport) and hot-cue authoring do not port now — the unified
surface keeps transport + silence + deck-control takeover only. When it
returns, the anticipated shape is focused-slot addressing (hardware gestures
act on the visibly focused slot's track/deck).

## Affordance disposition (resolved in the same session)

**Port**: GlobalMinimap; ConductorLanePlayhead; decode prefetch on open;
grid-to-grid SNAP generalized to "focused slot's grid onto the routine clock"
with an on/off toggle; beat-domain window readouts (bar.beat). **Linked
toggle survives, re-homed between slots**: each adjacent slot pair carries
the symmetric Linked toggle between its rows (generalizes to routines —
every adjacent cast pair is toggleable). **Drop**: deck cards + BPM
commit/save (grid tooling's job), swap A⇄B (picker ⇄ replaces it),
lockedWindow. **Code cut**: MixPlayer and DawTimeline retire;
RoutinePlayer/RoutineTimeline are the only player/timeline; the inline
audition-arm reimplementation consolidates into the shared module.

## Rollout (resolved in the same session)

Five parkable phases, owned by the standing Mix-editor iteration lane:
(1) translation layer — exit test: open any existing Transition, audition,
byte-identical save; (2) picker/navigation + draft posture; (3) set-context
pin-follow + entry-point rewiring one at a time, pair editor behind a dev
fallback toggle; (4) affordance ports; (5) the cut — delete
TransitionEditor/DawTimeline/MixPlayer, templates, and the toggle. PRD:
`docs/prds/mix-editor-supersession.md`.

## Consequences

- The unified surface must speak the pair window algebra for 2-slot
  artifacts (window anchors, incoming entry alignment, crop-vs-stretch,
  locked window) — the price of the artifact staying context-free.
- Pair-only capabilities become surface features parameterized by artifact
  kind, not a separate view: evidence siblings/favorites, take
  review-before-promotion, pair synthesis (assign A/B), templates, set
  context + pin-follow, MIDI depth.
- Every Transition-editor entry point (top-bar mode, requestPairEdit,
  requestTakeReview, AudioOwnershipChip, last-pair restore, browse host)
  rewires to the unified surface.

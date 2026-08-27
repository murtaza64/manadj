# PRD: Mix editor supersession

The Routine editor becomes the **Mix editor** — the single editing surface for
Transitions, Cameos, and Routines — and the Transition editor is deleted.
Decisions and rationale: ADR 0037. Glossary: **Mix editor** (short: Editor);
"Transition editor"/"Routine editor" retired; "Transition template" retired
(feature dropped).

## Non-goals

- No artifact migration: Transition/Cameo/Routine storage unchanged (ADR 0035
  reaffirmed).
- No MIDI depth or hot-cue authoring (deferred; future shape: focused-slot
  addressing).
- No templates replacement.
- No routine-native "choreography recipes".

## Phases

Each phase parks for review on the owning lane's app. Owner: the standing
Mix-editor iteration lane (currently `routine-editor-iteration-190…`).

### 1 — Translation layer

Pair↔slot projection: slot 0 = outgoing anchored at window start, slot 1
entry offset = incoming alignment; lanes rebased to the beat-domain clock via
the outgoing's Beatgrid; save projects back to the seconds-anchored artifact.

- Untouched fields round-trip losslessly (save re-derives only edited fields).
- Gridless tracks: degraded seconds mode, never locked out.
- RoutinePlayer 2-slot parity (Cameo host/guest included).
- Audition-arm consolidation into the shared module.
- **Exit test**: open any existing Transition in the Editor, audition flow-in
  and seek-in, save without edits → byte-identical artifact; edit one lane
  point → only that field re-derived.

### 2 — Picker/navigation + draft posture

- Move page: two track query chips (typeahead, Enter/Enter), ⇄ direction
  flip; groups: Transitions (favorite-first, ★/rename/delete inline), Takes,
  Cameos, Routines-through-the-pair; pinned `+ New Transition A → B`.
- Single-chip page: everything out of / into / over one Track.
- Cold open: search focused; deck-state surfacing (Transitions between loaded
  pairs, Routines whose cast intersects loaded Tracks).
- Draft everywhere: unpromoted evidence (Take / Cameo Take / Routine Take /
  candidate) opens as a review draft; Promote is the explicit persisting act;
  blank/review drafts persist nothing until then (reverses #170's
  promote-on-open).
- New pair drafts seed at the outgoing's outro (~32 beats), grid-aligned.
- Scoped sibling cycling within the current move.
- Open item: Favorite ★ extension to Routines.

### 3 — Set context + entry-point rewiring

- Pin-follow generalized by kind; sticky to the move, not the surface
  (navigating away disarms it visibly); Take promotion re-points Set pins.
- Rewire one at a time: Set adjacency rows → history rows → take review →
  AudioOwnershipChip → last-artifact restore → browse host (keyboard ←/→
  role-assign preserved for pair drafts).
- Pair editor reachable behind a dev fallback toggle throughout.

### 4 — Affordance ports

GlobalMinimap; ConductorLanePlayhead; decode prefetch on open; grid-to-grid
SNAP ("focused slot's grid onto the routine clock", with toggle); beat-domain
window readouts (bar.beat); Linked toggle between adjacent slot rows (any
adjacent cast pair).

### 5 — The cut

Delete TransitionEditor, DawTimeline, MixPlayer, `transition_templates`
router + template UI, the fallback toggle. Entry-point inventory must be
empty of pair-editor references.

## Reference

Feature-gap matrix and entry-point inventory: produced 2026-08-27 from the
pair editor and the #190 lane's in-flight state; re-derive from code when a
phase starts (both surfaces move fast).

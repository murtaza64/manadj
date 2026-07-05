# Take review and promotion: vectorizer v1 (continuous idealization)

Status: ready-for-agent

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

Opening a Take from the Transition history loads its pair into the Transition editor — outgoing Track always in the A role, regardless of physical deck during capture — and runs the **vectorizer**: a pure module deriving an ordinary seconds-based Transition draft from the raw event slice. Idealization per ADR 0020:

- Window → anchors and duration; `bInSec` chosen at the Handover's commit point
- Nudges and pitch riding collapse into the single static alignment and static tempo-match
- Crossfader × channel-fader compose into the per-deck fader lanes (a crossfader flick becomes a rectangular cut); EQ and filter moves map to their lanes
- Dense captured curves simplify to sparse lane breakpoints (editable polylines, not thousands of points)

The draft arrives **unsaved** under the existing lazy-persistence rules — auditioning and abandoning costs nothing. Saving is **promotion**: the normal editor save path persists an ordinary Transition on the pair (an additional one if the pair already has Transitions), and the Take gains a reference to it. The history shows promoted Takes with a mark and a one-click jump to the promoted Transition in the editor. Takes remain in the history after promotion, immutable.

Discrete gestures (beat jumps, hot cues) are ignored by the vectorizer in this slice — issue 04.

## Acceptance criteria

- [ ] A history entry opens the editor with the Take's pair loaded, outgoing in the A role
- [ ] The opened draft is unsaved; leaving without saving persists nothing (lazy-persistence rules)
- [ ] Auditioning the draft plays a recognizable rendition of the performed mix (fader/EQ/filter moves, alignment, tempo-match)
- [ ] A crossfader-performed blend arrives as fader-lane shapes; performance with Nudge corrections arrives with clean static alignment and tempo-match
- [ ] Derived lanes are sparse editable breakpoints; the user can tweak before saving
- [ ] Saving promotes: an ordinary Transition appears on the pair in the Transition library (coexisting with any existing Transitions), and the Take records the promoted reference
- [ ] History marks promoted Takes and jumps to their Transition in one click
- [ ] The Take itself is unchanged by promotion apart from the reference
- [ ] Pure vectorizer tests: synthetic Take slices → asserted draft shape (crossfader composition, Nudge collapse, anchor/tempoMatch derivation, breakpoint simplification)

## Blocked by

- `02-capture-detector-takes-history.md`

## Comments

**Done** (jj change `plozolwr`, lane `takes01`, 2026-07-05). All acceptance criteria met:

- **Vectorizer** (`frontend/src/capture/vectorize.ts`, pure, 14 tests): raw slice → seconds Transition draft. Anchors from playhead samples (ticks + transport events) extrapolated at each deck's own rate; **alignment read at the commit point** (window end, after all corrections) and back-projected — Nudges fold INTO the static alignment (review finding; PRD's "commit point"). Negative `bInSec` (lead gaps) supported — no clamps (review finding). Crossfader × channel fader compose into fader-POSITION lanes (exact inverse of the quadratic taper × dipless curve); EQ 1:1; filter to lane domain; RDP-simplified sparse breakpoints; incoming fader lane always drawn (its default ramp would lie); untouched controls stay out. Settled incoming pitch vs BPM ratio decides static tempoMatch (±1.5%). Jumps deferred to issue 04 (comment marks where back-projection must subtract them).
- **Slice init head**: the detector stamps engagement-open state (controls, pitch, trackIds, crossfader) + deck roles into every Take slice as a synthetic `init` event — vectorization starts from known state, not defaults; wire stays schema-free.
- **Review flow**: history row → `requestTakeReview` → editor (App listens, view switches). Outgoing Track always in the editor's A role. Unpromoted Take vectorizes into a **take draft**: pristine-LIKE session item — visible, auditionable, tweakable, filtered from every persist; leaving/discarding evaporates it. Re-stamp replaces (no orphans); deleting the draft item clears the review ref (both review findings, tested).
- **Promotion = explicit act**: banner's "Promote to library" → the draft persists via the normal pair-replace path (tweaks included) and `PATCH /api/takes/{uuid}/promoted` records the Transition uuid on the Take (clearable; 404-guarded; TestClient-tested). History shows ★ and a row click on a promoted Take jumps straight to its Transition (`selectTransition` — selection-only, never arms a save).
- Takes themselves stay immutable apart from the promoted reference.

Deviation from the issue's letter: "saving promotes" — the editor autosaves, so the explicit **Promote** act plays the save role for drafts (browsing must cost nothing; ADR 0011's lazy-persistence spirit). Recorded here as the intended reading.

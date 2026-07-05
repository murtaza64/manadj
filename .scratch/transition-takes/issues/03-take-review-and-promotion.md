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

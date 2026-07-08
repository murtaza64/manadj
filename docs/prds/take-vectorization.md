# PRD: Gesture-level idealization in Take Vectorization

Status: ready-for-agent

**Prototype-first: do not commit to the segmentation design until it has been exercised extensively against real captured Takes.** See Implementation Decisions (Phase 0) and Further Notes.

## Problem Statement

Opening a Take runs Vectorization, which turns the raw capture events into a Transition draft. Its current simplification pass (RDP) removes redundant points but doesn't idealize: a hand-ridden fader fade survives as dozens of micro-breakpoints tracing the wobble. Every breakpoint is an individually draggable handle in the lane editor — no multi-select, no thinning — so a faithful-to-the-jitter polyline is miserable to review and tweak. The intent was "one smooth ramp over 16 beats"; the draft should say that.

## Solution

Vectorization idealizes at the gesture level. Each lane's recorded curve is segmented into a small alphabet of DJ moves — plateaus (held values), ramps (sustained directional moves), steps (slams, already preserved) — and emits the minimal breakpoints that spell those segments. Boundary values snap to the lane's detents (EQ/filter: 0, 0.5, 1; fader: 0, 1); boundary instants snap to nearby beats. Wobble vanishes; intent survives; a lane that was "basically neutral with jitter" disappears entirely. Stretches the segmenter can't classify keep their current RDP treatment, so nothing is ever mangled beyond hand repair. The result is a draft whose handful of breakpoints reads — and edits — like something drawn on purpose.

## User Stories

1. As a DJ reviewing a Take, I want a 32-beat hand-ridden fade to vectorize into a single two-point ramp, so that the draft states my intent instead of my hand tremor
2. As a DJ reviewing a Take, I want a held level with jitter to vectorize into a flat plateau at the dwelled value, so that noise never becomes breakpoints
3. As a DJ reviewing a Take, I want fader slams and EQ kills preserved as crisp steps, so that idealization never smooths a deliberate hard move into a ramp
4. As a DJ reviewing a Take, I want a quick coherent fader dip (a cross-cut) preserved as a dip, so that brief intentional moves are never erased as wobble
5. As a DJ reviewing a Take, I want a filter sweep's apex to survive simplification, so that the shape of the move is kept even as jitter along it is dropped
6. As a DJ reviewing a Take, I want plateau and ramp-endpoint values near a detent to land exactly on it (EQ/filter center 0.5, extremes 0 and 1), so that "returned to neutral" compares clean against defaults everywhere downstream
7. As a DJ reviewing a Take, I want an EQ lane that was effectively neutral throughout to be dropped from the draft entirely, so that ghost lanes of pure jitter never appear
8. As a DJ reviewing a Take, I want segment boundaries that landed within ±1/8 beat of a beat snapped onto it, so that my slightly-early slam sits on the downbeat I meant
9. As a DJ reviewing a Take, I want deliberately off-beat moves (outside the tight snap window) left exactly where I played them, so that quantization never changes the feel of the mix
10. As a DJ reviewing a Take, I want simultaneous moves on both decks to land on the same beat when both were meant on it, so that coordinated moves stay coordinated
11. As a DJ editing a vectorized draft, I want few enough breakpoints that each is individually grabbable, so that tweaking the draft is pleasant rather than surgical
12. As a DJ, I want a squiggle the segmenter can't classify to keep its current RDP simplification for that stretch, so that ambiguous playing degrades gracefully instead of being force-fit
13. As a DJ, I want idealization to happen invisibly when I open a Take, so that there is no simplification UI to operate
14. As a DJ, I want re-opening an unpromoted Take after the heuristics improve to yield a better draft, so that tuning benefits my whole backlog for free
15. As a DJ, I want promotion to bake the draft I reviewed, so that a saved Transition never changes under me when tuning changes
16. As the developer tuning idealization, I want a prototype harness that renders before/after lanes for real captured Takes, so that thresholds are chosen against actual playing rather than synthetic curves
17. As the developer, I want threshold changes to be re-runnable over the real-Take corpus, so that a tuning regression is visible immediately

## Implementation Decisions

- **Phase 0 — prototype before committing.** Build a throwaway harness that runs candidate segmentation over the raw event slices of real Takes from the DB and renders recorded curve vs. idealized polyline side by side, per lane. Tune the alphabet thresholds, detent tolerance, and beat-snap window against that corpus. Only when the output reads right across the real corpus does the design graduate into the production vectorizer. The gesture-alphabet decisions below are the design to prototype, not a fait accompli — the prototype may send us back to grilling.
- All production work lands in the pure vectorizer module (raw Take slice → Transition draft). No store, UI, backend, or schema changes; ADR 0020's boundary (raw Take = evidence, Vectorization = re-runnable opinion) is unchanged.
- **Gesture-vocabulary segmentation, per lane**: classify the recorded curve into plateaus, ramps, and steps; emit minimal breakpoints per segment (plateau = flat, ramp = 2 points, step = the existing vertical shoulder pair). Unclassifiable stretches fall back to the current RDP output for that stretch.
- **Wobble discrimination is by amplitude and coherence, not duration**: sustained small-amplitude oscillation around a level is wobble, erased into its plateau; a brief coherent large excursion is a gesture and survives. No minimum-duration rule.
- **Value snapping**: segment boundary values (plateau dwells, ramp endpoints) within ~0.03 of a detent snap to it. Per-lane detent sets: EQ and filter 0/0.5/1; fader 0/1. Never snap mid-ramp interior points. Snapped-to-neutral lanes then evaporate via the existing lane-drop rules.
- **Beat snapping**: segment boundaries (step instants, plateau/ramp junctions) within ±1/8 beat of a beat on the mix-time beatgrid (the outgoing Track's — its time ≡ mix time) snap to it. Beats only, no bar-level snapping. This is also the sole cross-lane coordination mechanism — lanes are segmented independently.
- **Fixed parameters, no UI**: thresholds are code-tuned heuristics (per the glossary: tunable, not part of the definition). No strength slider, no manual re-simplify command.
- **Existing composition steps unchanged**: anchor/tempo-match distillation, crossfader composition into per-deck fader lanes, Jump-event preservation, and loop collapse all stay as they are; this feature replaces only the lane-curve simplification stage.

## Testing Decisions

- Test at the vectorizer's existing seam: feed a raw event slice, assert on the emitted Transition's lanes. External behavior only — assert breakpoint counts, positions, and values, never internal segment labels.
- Extend the vectorizer's existing test suite; its current tests are the prior art and must keep passing (steps, shoulders, lane-drop rules, always-emitted incoming fader).
- New coverage from the grilling scenarios: jittery ramp → 2 points; kill/hold/restore → step-plateau-step; sweep apex survival; quick dip preservation; detent snapping (and non-snapping outside tolerance, and no mid-ramp snapping); beat snapping inside/outside ±1/8 beat; neutral-jitter lane evaporation; RDP fallback on an unclassifiable stretch.
- Once tuned, promote a handful of real-Take slices from the prototype corpus into fixture tests, so the suite guards against regressions on actual playing, not just constructed curves.

## Out of Scope

- Any simplification UI (strength control, review-time re-run, manual "simplify lane" on hand-drawn lanes)
- Re-vectorizing already-promoted Transitions (promotion bakes; ADR 0020 stance unchanged)
- Changes to capture/recording (event-per-change granularity, clock source)
- Cross-lane joint segmentation beyond shared beat snapping
- Bar-level or phrase-level quantization
- Editor ergonomics for dense polylines (multi-select, thinning on edit) — this feature removes the need rather than addressing it

## Further Notes

- **The prototype gate is the point of this PRD.** Segmentation heuristics against real human playing are exactly the kind of design that looks right in prose and falls apart on contact; the corpus of raw Takes already in the DB is the ground truth to tune against, in the spirit of the Handover-detection tuning ground. Budget real time in Phase 0.
- Glossary updated during the design session: **Vectorization** canonicalized (avoid "reify"); the **Take** entry corrected — idealization belongs to Vectorization, not promotion (old attribution noted with date).
- No new ADR: vectorization is re-runnable opinion and thresholds are tunable, so the decision isn't hard to reverse. ADR 0020's title still says "idealizing promotion"; ADRs are historical records and the glossary carries the correction.
- Capture timestamps are wall-clock (`performance.now`), not audio-clock — a mild constant skew against the derived mix timeline is expected and is part of why the beat-snap window exists; the prototype should confirm ±1/8 beat absorbs it.

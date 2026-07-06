# 30 — Reverse-chop motion: beat-length bass-in pulses (dnb chops)

Status: ready-for-agent (grilled 2026-07-05; design settled below)

## Parent

.scratch/mix-editor/ (Transition editor tracker; filed 2026-07-05 from human feedback, grilled 2026-07-05)

## The ask

A one-gesture way to author a **reverse chop**: momentarily hand the bass to the incoming track for a beat or two, then snap back — the dnb teaser move. Previously drawn by hand as 4+ breakpoints across the paired low-EQ lanes, twice per chop.

## Design (settled in the 2026-07-05 grill)

One new lane primitive — **swap** — beside the existing cut (`insertChop`, `mixModel.ts:473`):

- **Gesture grammar**: shift+drag/click on a lane = cut that lane (unchanged). **alt+shift+drag/click = swap that lane with its partner** (`eqLowA↔eqLowB`, `faderA↔faderB`, etc.). Drag spans beats (edges hard-snap to beat guides, same as cut); click = one beat interval. No modal, no palette, no mode state — the lane picks the target, the modifier picks the primitive.
- **Chop kinds compose by stamping**: bass chop = swap on eqLow; fader swap = swap on faders; "bass swap + fader cut" = two stamps at the same span (snap makes edges coincide exactly). Named compound motions are the known v2 seam, only if real usage demands them.
- **Swap semantics — flat hold**: sample each lane's evaluated value at the entry edge; stamp the *partner's* sampled value as a flat hold across the interval; revert to the lane's *own* evaluated value at the exit edge. Interior breakpoints removed. 4 points per lane, 8 total — same shape as `insertChop`. Direction needs no toggle: it emerges from current lane state (A flat / B killed → chop hands bass to B; mirrored state gives the forward chop; equal values = honest no-op).
- **Walls**: reuse the 20ms walls verbatim, centered on beatlines, coincident across both lanes (clean handoff — no both-basses/no-bass gap).
- **After insert: dissolves** into ordinary breakpoints (consistent with cut; issue 16's group selection covers post-hoc editing; re-authoring is one gesture anyway).
- **Hidden partner**: the stamp **unhides** the partner lane (no silent mutation of invisible state).
- **Beat domain**: bakes to normalized x on insert, like every other lane edit (nothing in the editor stays beat-attached; templates included, `templateModel.ts:16`).
- **Templates**: nothing to do — swap emits plain breakpoints, so templates capture chops for free.
- **Capture/vectorization**: out of scope. Verified: a full-swing 1–2 beat paired-EQ swap survives Take vectorization (RDP tolerance is vertical, 0.015 lane units — a 0.5 swing clears it 30x; `frontend/src/capture/vectorize.ts:40`). It arrives un-idealized; chop *recognition* is a possible later vectorizer refinement.
- Relation to sets issue 29 (B-interlude doubles): kept separate — chop = lane authoring sugar within a Transition's window; interlude = artifact/model gap.

## What to build

- Pure function `insertSwap(pointsA, pointsB, x1, x2, wall)` (or similar) in `mixModel.ts` beside `insertChop` — returns both lanes' new point arrays per the flat-hold semantics above.
- `LaneCanvas.tsx` gesture wiring: alt+shift+drag (span, snapped edges via `snapCutX`) and alt+shift+click (one beat interval via `beatIntervalAt`), mirroring the existing shift cut paths; partner-lane resolution + unhide.
- Same wall constant plumbing as cut (`chopWall`, `DawTimeline.tsx:924`).

## Acceptance criteria

- [ ] alt+shift+drag on eqLowA over a 2-beat span stamps the reverse chop: A-low holds B-low's entry value, B-low holds A-low's entry value, both revert at the exit edge; 20ms walls centered on the snapped beatlines, coincident across lanes
- [ ] alt+shift+click stamps a one-beat swap on the interval under the pointer
- [ ] Chop dropped mid-ramp: entry/exit points sit on the evaluated curve (blend around the chop is undistorted)
- [ ] Equal-valued lanes → no-op (or visually inert stamp); direction emerges from lane state, no toggle anywhere
- [ ] Swap on a lane whose partner is hidden unhides the partner
- [ ] Existing gestures unchanged: shift cut, shift+click one-beat cut, plain drag, click-add, dblclick remove
- [ ] Save-as-template after stamping chops → applying the template reproduces them (no template changes needed; regression check)
- [ ] Pure-module vitest for the swap function: flat-hold sampling, interior-point removal, wall geometry, mid-ramp entry/exit, no-op case
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None — can start immediately. Coordinate with issue 16 (in flight, same LaneCanvas gesture code) before landing.

## Comments

**2026-07-05 grill.** Modal/palette considered and rejected (flow gesture, four times in eight bars; editor design language reserves modals for rare deliberate acts). Motions-library fork deferred to v2 behind real-usage evidence — cut + swap compose to every chop kind named so far. Original open questions (beat vs lane domain, grouped vs dissolved, direction variants, template interaction, vectorization survival) all resolved as recorded above; codebase research pre-answered beat-domain (bake), templates (free), and vectorization (survives, un-idealized).

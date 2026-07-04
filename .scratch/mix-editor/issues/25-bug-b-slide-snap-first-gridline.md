# 25 — BUG: B slide snap doesn't align B's grid to A's grid

Status: closed (implemented change ytqwklpu, two rounds; user-verified
2026-07-04 — grid-to-grid snap confirmed on Weeble Wobble × Bombalaya)

Root cause — the unlocked bMove snap (`DawTimeline.tsx`) never targeted
the actual invariant (B beats on A beats); both regimes snapped to proxies:

1. Negative anchor (lead gap): snapped `audioStart` — mix-time of B's FILE
   start (track t=0) — to A's grid. When B's beatgrid begins past t=0
   (pickup/silence), every B beat sat off-grid by `beatsB[0]/rateB`.
2. Positive anchor (round 2, Weeble Wobble × Bombalaya): snapped `bInSec`
   to B's grid — a B beat on the WINDOW START. But `startSec` (typed, e.g.
   30.0) need not sit on A's grid, so B's whole grid carried that residue.

Fix (unified): take B's beat nearest the window anchor (`nearestTime(
beatsB, bIn)` — degenerates to B's first beat in a lead gap), land its
mix-time position on A's nearest gridline, solve back for `bInSec`.
Fallbacks when one grid is missing: no A grid → B beat on window start
(old positive behavior); no B grid → audio start on A's grid (old
negative behavior).

## Parent

`.scratch/mix-editor/PRD.md`. Reported by the user 2026-07-04 during the
issue-11/12 verification tour (two screenshot rounds). Follow-up from
issue 11.

## Symptom

With snap on, sliding B leaves B's gridlines slightly off A's gridlines —
first seen with a lead gap (file start snapped to A's grid), then again
mid-track with `start` typed as 30.0 (B beat snapped to an off-grid
window edge).

## Acceptance criteria

- [ ] Dragging B (unlocked, snap on) lands B's gridlines on A's
      gridlines — verify by eye at beat zoom, lead-gap and mid-track
- [ ] Works regardless of whether `startSec` sits on A's grid
- [ ] Fallbacks: missing A grid → B beat on window start; missing B
      grid → audio start on A's grid
- [ ] tsc, eslint on touched files, vitest green

## Notes

Snap math lives inline in the drag handler and is untested (issue-11
vitest covers `slideB`/`slideBToCue` only). If this branch churns again,
extract a pure `snapBIn(...)` into `mixModel.ts` and table-test it.

## Blocked by

None.

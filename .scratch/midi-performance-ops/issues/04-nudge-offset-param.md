# Offset-parameterized beatgrid nudge endpoint

Status: ready-for-human
Review: parked on lane midigrid (grid track stack, review lands the prefix); walkthrough in .lanes/midigrid.md and the requesting session; lane app http://localhost:5423

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

The backend grid-nudge endpoint takes a fixed ±10ms step today. Give it an explicit millisecond offset parameter so one API serves both the discrete tap (±10ms) and the accumulated spin-to-nudge commit (±n ms, issue 06). The existing on-screen nudge buttons and keyboard shortcuts pass the same 10ms they always meant.

## Acceptance criteria

- [ ] The nudge endpoint accepts a signed millisecond offset and translates the grid by exactly that amount
- [ ] Existing UI/keyboard nudges behave identically to before (±10ms)
- [ ] Router tests (existing backend seam) cover arbitrary offsets, sign, and accumulation across calls
- [ ] No change to anchor/set-downbeat or delete semantics

## Blocked by

None - can start immediately

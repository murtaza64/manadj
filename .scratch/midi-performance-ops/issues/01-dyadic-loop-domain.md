# Widen the Active loop domain to dyadic 1/8–128 with set-length resize

Status: ready-for-agent

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

The glossary already says it (Active loop, updated 2026-07-05): lengths are dyadic beat counts within 1/8–128; halve/double are pure ×2/÷2 with clamping; preset ladders are entry points, not the domain. Make the code agree:

- Raise the loop max from 32 to 128 beats.
- Generalize resize from halve/double-only to set-length (an absolute target length), with halve/double expressed through it. Existing resize semantics unchanged: start edge fixed, phase-mod re-entry when a shrink strands the playhead, pending size when idle.
- Non-power-of-two dyadic lengths (e.g. 3/4) flow through engage, resize, and the seconds projection without special-casing.

Demoable from the existing on-screen loop row: double a loop past 32.

## Acceptance criteria

- [ ] A loop can be doubled up to 128 beats and no further; halved to 1/8 and no further
- [ ] Set-length resize keeps the start edge fixed and re-enters a stranded playhead at phase mod new length
- [ ] A 3/4-beat loop engages, halves to 3/8, doubles to 3/2, and projects to seconds correctly
- [ ] Loop math tests (existing pure seam) cover the new clamp bounds, set-length resize, and 3/4 arithmetic
- [ ] On-screen loop row behavior unchanged for the existing ladder

## Blocked by

None - can start immediately

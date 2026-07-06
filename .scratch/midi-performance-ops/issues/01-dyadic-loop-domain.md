# Widen the Active loop domain to dyadic 1/8–128 with set-length resize

Status: done

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

## Comments

- 2026-07-06 (midiops lane, change `lplwwoxk`): implemented. `LOOP_MAX_BEATS` 32→128; resize generalized to `LoopResize` (`'halve' | 'double' | { beats }`) via `resizeLoopBeats` in `frontend/src/playback/loop.ts`, one code path in the `loop-resize` reducer case; `formatLoopBeats` renders any dyadic as a reduced fraction (3/4, 3/8, 3/2). Verified: loop math + transport reducer tests (clamp bounds, set-length, 3/4 ladder), full `npx vitest run` (1252) green, tsc + build green. Awaiting human review — walkthrough on issue 02.
- 2026-07-06: verified by human (on-screen loop row: double past 32 to 128, halve to 1/8, 3/4 ladder) — landed on main in merge `tsyuqvkl`. Done.

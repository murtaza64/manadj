# bpm-grid-authority

Enforce ADR 0027 (grilled 2026-07-05): one served grid-first BPM,
placeholder grids as computed projections, exact variable-grid beats with
a dominant-BPM doctrine for tempo-domain features, beat-domain jump math,
seconds-identity loops.

Origin: BPM/grid divergence audit after cue-quantize-bpm 01/02 (three
parallel explorations; findings and file:line pointers in the issues).

## Slices

| # | Issue | Layer |
|---|---|---|
| 01 | served bpm := grid-first; drop `bpm_effective`; column backfill | backend + mechanical frontend |
| 02 | file→DB writer guards; compare vs grid-first | backend |
| 03 | placeholder non-persistence; origin-aware authority | backend |
| 04 | variable-grid beat expansion; doctrine note | backend |
| 05 | grid-based `jumpBeats` | frontend |
| 06 | loop resize on seconds; `lengthBeats` display projection | frontend |
| 07 | Follow `bpmCenter` / MATCH gate via track cache | frontend |
| 08 | cleanup: delete-projection, GET error semantics, `dominantBpm` unification, downbeat epsilon | both |

01→02→03 are the backend core, in order (01 defines the projection 02/03
lean on). 04–08 are independent of each other; 04 should precede heavy
variable-grid testing of 05.

## Landing policy

Review-gated feature work (ADR 0026): verify per issue, park
ready-for-human with a verification walkthrough; never advance `main`
without approval.

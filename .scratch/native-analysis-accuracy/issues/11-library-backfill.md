# 11 — Ladder-respecting library backfill

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

One bulk run over the existing library with the new analyzers, respecting the ladder (issue 09): tracks with generated/analyzed grids and analyzed keys get fresh analysis; Engine-imported and hand-edited data untouched. Produces a summary: rewritten / skipped-by-ladder / bailed counts, and the bailed list feeding the needs-attention worklist. Real-DB operation — runs in the default workspace after landing, per parallel-work rules.

## Acceptance criteria

- [ ] Backfill command runs library-wide with progress and a final summary
- [ ] Ladder respected (verified by summary counts vs known imported/edited populations)
- [ ] Bailed tracks flagged needs-attention
- [ ] Idempotent: re-running skips already-current analysis

## Blocked by

- 09

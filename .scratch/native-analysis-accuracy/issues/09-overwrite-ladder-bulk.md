# 09 — Overwrite ladder on bulk runs

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Precedence protection for bulk/automatic analysis runs: grids `generated < analyzed < imported < edited`, keys `analyzed < imported < manual`. Bulk runs skip (and report skipping) any Track whose current value outranks `analyzed`. Manual single-track re-analysis ignores the ladder and overwrites freely — explicit intent. Subsumes the analysis-curation issue "protect manual overrides".

## Acceptance criteria

- [ ] Bulk run never overwrites imported/edited grids or imported/manual keys; skips are reported
- [ ] Bulk run does overwrite generated/analyzed grids and analyzed keys
- [ ] Manual single-track analyze overwrites regardless of provenance
- [ ] Behavior tests cover each rung of both ladders
- [ ] analysis-curation issue 01 marked subsumed with a pointer here

## Blocked by

- 07
- 08

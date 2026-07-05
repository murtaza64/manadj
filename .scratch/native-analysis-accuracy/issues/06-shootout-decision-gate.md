# 06 — Run shootout, verify disputed sample, record winners

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

The decision gate closing Phase A. Run the full harness (all grid and key candidates) over the corpus, produce a single comparison report, and hand-verify a sample of disputed-tier tracks (promoting them via the issue-01 override file) to sanity-check that gold-tier scores generalize. Record the winning grid tracker + fit parameters and key backend/profile in this issue and in the PRD. Winner sign-off is the user's call — agent prepares the report and a recommendation.

Existing ad-hoc benchmark scripts (TempoCNN, keyfinder comparison, BPM method benchmarks) are superseded and deleted.

## Acceptance criteria

- [ ] One report comparing all candidates on all metrics (BPM, half/double, phase, bail rate; key breakdown + mixable rate)
- [ ] ≥10 disputed tracks hand-verified and promoted; scores re-run after promotion
- [ ] Winners + parameters recorded in this issue and the PRD (user signed off)
- [ ] Superseded experiment scripts deleted

## Blocked by

- 04
- 05

# 08 — Key provenance and winning key backend

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Wire the winning key backend/profile (issue 06) in as native key Analysis, and give keys provenance: `analyzed` / `imported` / `manual`. Native analysis writes `analyzed`; External Import writes `imported` (existing Engine/RB key import paths set it); direct user edits write `manual`. Existing keys get provenance backfilled where derivable (Engine-imported → `imported`), else `analyzed`.

## Acceptance criteria

- [ ] Manual analyze writes key with provenance `analyzed` using the winning backend
- [ ] Import and manual-edit paths set their provenance values
- [ ] Migration adds provenance and backfills existing rows
- [ ] Behavior tests at the analysis seam with a stubbed key candidate

## Blocked by

- 06

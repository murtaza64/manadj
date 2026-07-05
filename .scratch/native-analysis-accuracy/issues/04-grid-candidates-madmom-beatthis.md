# 04 — Grid candidates: madmom DBN, beat_this, TempoCNN cross-check

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Additional Stage-1 grid candidates behind the interface from issue 02, all sharing the same constant-fit stage and scoring: madmom DBN beat tracker (required), beat_this (optional — skip with a note if install/runtime is painful on this machine), and TempoCNN as a tempo-only cross-check column in the report (no phase, not a grid candidate).

## Acceptance criteria

- [ ] madmom DBN candidate scored by the same harness command
- [ ] beat_this scored or explicitly skipped with reason recorded in this issue
- [ ] TempoCNN tempo agreement reported as a cross-check column
- [ ] Heavy deps (madmom, beat_this) absent from the app import chain (guard passes)

## Blocked by

- 02

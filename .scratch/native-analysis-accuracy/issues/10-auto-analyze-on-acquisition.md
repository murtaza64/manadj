# 10 — Auto-analyze on acquisition

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Newly acquired Tracks are analyzed automatically: acquisition enqueues a grid+key analysis task in the in-process task system (ADR 0003), like waveform generation. New tracks have no saved info, so no ladder interaction. Startup sweep picks up tracks missing analysis the same way waveforms do.

## Acceptance criteria

- [ ] Acquisition enqueues analysis; a newly acquired track ends up with grid, BPM, key (or needs-attention flag on bail) without manual action
- [ ] Startup sweep enqueues analysis for tracks lacking it
- [ ] Task failures surface like other task failures; no retry storms on repeated bail
- [ ] Behavior tests at the task seam with a stubbed candidate

## Blocked by

- 07
- 08

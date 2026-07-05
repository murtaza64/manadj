# 02 — Grid harness tracer bullet: Essentia baseline scored

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

The grid arm of the shootout harness, end-to-end with one candidate. Defines the candidate analyzer interface (audio in → fit result: BPM, phase, residual/confidence, bail flag, evidence). Implements Stage 2 — the shared constant fit over tracker ticks (Mixxx const-region-informed: fit constant regions, integer BPM when within threshold, fractional otherwise, bail on poor fit) — and Stage 1 for the baseline candidate: Essentia RhythmExtractor2013 ticks. Harness runs the candidate over the gold-tier corpus and emits a score table: BPM accuracy (within 0.05), half/double-time as a distinct error class, phase error mod beat vs Engine, bail rate, per-track failure list.

Heavy deps stay behind candidate implementations (import-hygiene guard applies).

## Acceptance criteria

- [ ] Candidate interface defined; Essentia baseline implements it
- [ ] Constant fit is candidate-agnostic and pure-function tested with synthetic ticks: perfect, jittered, half/double-time, variable (must bail), fractional BPM (must not snap)
- [ ] Scoring pure-function tested; half/double-time reported separately from jitter errors
- [ ] One command scores the baseline against the corpus from issue 01 and prints the table + failure list
- [ ] No app import chain changes (heavy-dep guard passes)

## Blocked by

- 01

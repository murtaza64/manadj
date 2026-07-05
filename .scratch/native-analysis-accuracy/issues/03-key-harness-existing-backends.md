# 03 — Key harness tracer bullet: existing backends scored

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

The key arm of the harness. Key candidates implement the candidate interface's key contract (audio in → Key + confidence). Candidates in this slice: Essentia KeyExtractor swept across profiles (edma, edmm, bgate, braw, plus current default as baseline) and libkeyfinder. Scoring is MIREX-weighted with a per-class breakdown — exact, fifth up/down, relative major/minor, parallel, other — and a headline *mixable rate* (exact + fifth + relative). Scored against the gold-tier corpus keys from issue 01.

## Acceptance criteria

- [ ] Key candidate contract defined; Essentia profile sweep and libkeyfinder run through it
- [ ] MIREX-weighted scoring pure-function tested (all five error classes, notation conversions)
- [ ] One command scores all key candidates and prints per-candidate breakdown + mixable rate
- [ ] Per-track failure list per candidate
- [ ] No app import chain changes

## Blocked by

- 01

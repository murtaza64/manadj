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

## Comments

**2026-07-05 (agent, lane `analysis`, change ltvtrkrk)** — Done. `harness/key_scoring.py` (MIREX classifier over Engine-ID circle-of-fifths layout; classes exact/fifth/relative/parallel/other; headline mixable rate), `harness/key_candidates.py` (EssentiaKey profile sweep + KeyfinderCli), `harness/run_key.py` (multi-candidate CLI, per-candidate estimate cache under `data/keys/`). 11 pure tests. keyfinder-cli was not installed — built from source (evanpurkhiser/keyfinder-cli against brew libkeyfinder 2.2.8) into `~/.local/bin`.

150-gold-track sample: keyfinder 94.0% mixable / 77.9% exact; essentia_bgate=essentia_default (default IS bgate here) 91.3% mixable / 80.0% exact / best weighted 0.853; edma 85.3%, edmm 91.3% mixable — the EDM-tuned Faraldo profiles do NOT beat bgate/keyfinder on this corpus. Full-corpus run + winner decision: issue 06 (after madmom CNN, issue 05). Results: `data/key_results.json`.

**2026-07-05 (agent, post-review)** — Review fixes: abstaining detectors score `undetected` and decode failures `error`, both counting against the denominator (no inflated rates); corrected 150-track table: keyfinder 93.3% mixable / 77.3% exact (one decode error counted), essentia_bgate/default 91.3% / 80.0% exact / 0.853 weighted (best), braw 92.0%, edma 85.3%, edmm 91.3%.

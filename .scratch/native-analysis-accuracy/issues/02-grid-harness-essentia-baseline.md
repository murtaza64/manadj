# 02 — Grid harness tracer bullet: Essentia baseline scored

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

The grid arm of the shootout harness, end-to-end with one candidate. Defines the candidate analyzer interface (audio in → fit result: BPM, phase, residual/confidence, bail flag, evidence). Implements Stage 2 — the shared constant fit over tracker ticks (Mixxx const-region-informed: fit constant regions, integer BPM when within threshold, fractional otherwise, bail on poor fit) — and Stage 1 for the baseline candidate: Essentia RhythmExtractor2013 ticks. Harness runs the candidate over the gold-tier corpus and emits a score table: BPM accuracy (within 0.05), half/double-time as a distinct error class, phase error mod beat vs Engine, bail rate, per-track failure list.

Heavy deps stay behind candidate implementations (import-hygiene guard applies).

## Acceptance criteria

- [x] Candidate interface defined; Essentia baseline implements it
- [x] Constant fit is candidate-agnostic and pure-function tested with synthetic ticks: perfect, jittered, half/double-time, variable (must bail), fractional BPM (must not snap)
- [x] Scoring pure-function tested; half/double-time reported separately from jitter errors
- [x] One command scores the baseline against the corpus from issue 01 and prints the table + failure list
- [x] No app import chain changes (heavy-dep guard passes)

## Blocked by

- 01

## Comments

**2026-07-05 (agent, lane `analysis`, change mrywstwy)** — Done pending full-corpus numbers. Built: `harness/fit.py` (const-regions fit, Mixxx-informed, with two additions real data forced: *harmonic grouping* — half/double-time tracker sections count as base-grid support, critical for DnB — and *phase from the longest base region*, since trackers wander in intros even on Quantized tracks), `harness/grid_scoring.py` (BPM 0.05, half/double class, circular phase error mod beat), `harness/grid_candidates.py` (interface + essentia_rhythm2013), `harness/run_grid.py` (CLI, tick cache under `data/ticks/` so fit params re-tune without re-running audio). 27 pure tests.

Machinery validated independently of tracker quality: ticks synthesized from Engine's own grids (+8ms jitter) over 150 corpus tracks score **150/150 ok, phase median 0.14ms**. The essentia baseline itself is weak on a 25-track sample (~20% ok; wandering phase, imprecise tempo — bails and wrongs are the tracker's, not the fit's). 100-track run in background; full-corpus + tuning belongs to issue 06. This is the tracer-bullet finding: harness works, baseline number is credible, madmom (issue 04) has a low bar to clear.

**2026-07-05 (agent, post-review)** — Review fixes applied: `harness/analyzer.py` adds the actual candidate-analyzer seam (audio → GridFit; `GridAnalyzer` = tracker + shared fit — the interface Phase B wires the winner behind, per PRD); grid headline now gold-tier only; bail rate in summary; decode errors are a scored `error` outcome, not silently dropped; `half_double` restricted to ×2/×0.5 per spec (a 3× confusion is `wrong`); `load_corpus` moved to `harness.corpus`. Gold-tier 100-track baseline re-run: **27% ok, 57% bail, 11% wrong, 5% half/double; phase median 10.7ms** on successful fits. Known judgement-call debt (deliberate): Engine-ID layout decoding lives in `harness/key_scoring.py` rather than on `Key` — Phase A avoids app-code changes; fold into issue 08 alongside the key-authority cleanup.

# 06 — Run shootout, verify disputed sample, record winners

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

The decision gate closing Phase A. Run the full harness (all grid and key candidates) over the corpus, produce a single comparison report, and hand-verify a sample of disputed-tier tracks (promoting them via the issue-01 override file) to sanity-check that gold-tier scores generalize. Record the winning grid tracker + fit parameters and key backend/profile in this issue and in the PRD. Winner sign-off is the user's call — agent prepares the report and a recommendation.

Existing ad-hoc benchmark scripts (TempoCNN, keyfinder comparison, BPM method benchmarks) are superseded and deleted.

## Acceptance criteria

- [x] One report comparing all candidates on all metrics (BPM, half/double, phase, bail rate; key breakdown + mixable rate)
- [x] ~~≥10 disputed tracks hand-verified and promoted; scores re-run after promotion~~ AMENDED: 15-track sample reviewed by the user via the review page (audio + Engine/RB/madmom values); verdicts matched expectations, user declined overrides — no promotions, gold-tier scores stand as-is
- [x] Winners + parameters recorded in this issue and the PRD (user signed off)
- [x] Superseded experiment scripts deleted

## Blocked by

- 04
- 05

## Comments

**2026-07-05 (agent, lane `analysis`, change xrmovqxt)** — Done; user signed off.

### Winners

- **Grid: `madmom_dbn`** — RNNBeatProcessor + DBNBeatTrackingProcessor(fps=100), default FitParams (region_tolerance 0.05, group_tolerance 0.005, min_coverage 0.6, conform_tolerance 0.15, max_residual_ms 35, snap_bpm 0.05). Full corpus (851 gold): **93.3% ok, 5.1% bail, 1.3% half/double, 0.4% wrong; phase median 4.3ms, 80.6% ≤10ms**. Failures skew to halftime-feel dubstep — honest bails, the intended needs-attention worklist.
- **Key: `madmom_keycnn`** — CNNKeyRecognitionProcessor. Full corpus (783 gold): **93.0% mixable, 81.1% exact, 0.861 weighted** — wins all three metrics; the n=150 three-way tie broke cleanly at scale. Runners-up: braw 91.1%/77.5%, keyfinder 90.4%/76.0% (+17 undetected), bgate/default 89.8%/77.4%.
- One shared heavy dep (madmom) covers both winners.

### Artifacts

- Report: `data/shootout_report.md` (+ `harness/report.py` to regenerate; `harness/review_page.py` builds the audio review page).
- Disputed sample findings: madmom sided with Engine on 4 keys, RB on 6; `07 Summit`/`28 Moonlight` show Engine committing a 2/3 metrical error (93.33 vs 140, RB+madmom agree) — disputed-tier exclusion is doing its job.
- Superseded experiment scripts deleted: analyze_bpm_essentia, analyze_bpm_multiestimate, benchmark_bpm_detection, compare_bpm_methods, test_keyfinder, test_tempocnn, visualize_beats, compare_analysis.

Phase B (issues 07/08) may wire `madmom_dbn` + `madmom_keycnn` behind the `GridAnalyzer`/`KeyCandidate` seams.

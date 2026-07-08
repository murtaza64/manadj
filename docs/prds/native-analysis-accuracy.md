# PRD: Native Analysis Accuracy Overhaul

Status: ready-for-agent

## Problem Statement

manadj's native Analysis is measurably worse than Engine DJ, Rekordbox, and Mixxx. Native analysis produces only an integer-snapped BPM number (no Beatgrid — the artifact that is actually the tempo authority per ADR 0016), and its key detection is untrusted to the point that Engine's imported keys are treated as canonical. New acquisitions get no grid or key at all until manually analyzed. The BPM estimate ordering is hand-tuned by vibe rather than scored against ground truth.

## Solution

Rebuild native Analysis around two ideas (ADR 0024):

1. **Constant-fit-or-bail grid analysis.** Beat trackers emit ticks; ticks are evidence, never the grid. The analyzer fits a constant-tempo Beatgrid (BPM + phase) to the ticks — correct for a library of Quantized tracks — and bails (no grid, no BPM, needs-attention flag) when the fit is poor.
2. **Measured accuracy.** A benchmark harness scores candidate analyzers against the Ground truth corpus (gold tier = Engine and Rekordbox agree; disputed tier excluded until hand-verified). The shootout runs fully isolated from the UI; only the winner gets wired into the app.

Delivered in two phases: **Phase A** — harness and shootout, offline scripts only, zero app changes. **Phase B** — wire the winning analyzers into the app, add provenance protections, auto-analyze new acquisitions.

## User Stories

1. As a DJ, I want native grid analysis to place beats where Engine DJ would, so that tracks Engine has never seen are immediately mixable.
2. As a DJ, I want analyzed grids to be constant-tempo on my quantized tracks, so that beat math and sync don't wobble.
3. As a DJ, I want the analyzer to admit failure on unquantized tracks instead of guessing, so that I never trust a confidently wrong grid mid-mix.
4. As a DJ, I want failed-analysis tracks collected into a visible worklist, so that I can grid them manually or import from Engine.
5. As a DJ, I want fractional BPMs preserved when a track genuinely isn't integer-BPM, so that long blends don't drift.
6. As a DJ, I want native key detection I can trust at the mixable level (exact, adjacent-fifth, or relative), so that harmonic mixing works on fresh acquisitions.
7. As a curator, I want newly acquired tracks analyzed automatically, so that acquisition-to-mixable requires no manual step.
8. As a curator, I want bulk re-analysis to never overwrite my hand-edited grids or manually set keys, so that careless batch runs can't destroy curation work.
9. As a curator, I want bulk re-analysis to never overwrite Engine-imported grids and keys, so that trusted external data survives.
10. As a curator, I want a manually triggered single-track re-analysis to just overwrite, so that explicit intent isn't nagged with confirmations.
11. As a curator, I want to see a grid's origin (generated, analyzed, imported, edited), so that I know how much to trust it.
12. As a curator, I want a key's provenance (analyzed, imported, manual) recorded, so that protections and displays can distinguish them.
13. As the developer, I want a harness that scores any candidate analyzer against the Ground truth corpus with one command, so that algorithm choices are numbers, not vibes.
14. As the developer, I want the corpus tiered by Engine/Rekordbox agreement, so that scoring isn't polluted by tracks where the references themselves disagree.
15. As the developer, I want disputed-tier tracks surfaced as a review queue, so that hand verification can promote them to gold.
16. As the developer, I want half/double-time errors reported as a distinct error class, so that octave mistakes are visible separately from jitter.
17. As the developer, I want key scoring broken down MIREX-style (exact, fifth, relative, parallel, other) with a headline mixable rate, so that error severity matches DJ reality.
18. As the developer, I want grid phase error (mod beat, vs Engine) reported alongside BPM accuracy, so that a candidate can't win on tempo while losing the downbeat placement.
19. As the developer, I want fit diagnostics (candidate BPMs, residuals, tick summaries) stored per analysis, so that failures are debuggable after the fact.
20. As the developer, I want heavy analysis dependencies kept out of the app import chain, so that startup and test speed are preserved.
21. As the developer, I want the shootout to require no UI, API, or schema changes, so that Phase A can run in a lane without touching hotspots.
22. As the developer, I want the winning analyzer wired in behind the same interface the harness used, so that Phase B is a plumbing change, not a rewrite.
23. As the developer, I want a ladder-respecting bulk backfill over the existing library, so that old low-quality analysis is replaced everywhere it's safe to do so.

## Implementation Decisions

- **Candidate analyzer interface (the single new seam).** Every contender implements the same contract: grid analysis takes audio and returns a fit result (BPM, phase, fit residual/confidence, bail flag, evidence summary); key analysis takes audio and returns a key result (Key plus confidence). Heavy deps (essentia, madmom, beat_this, keyfinder) live strictly behind implementations of this interface. The harness and the app both consume candidates through it.
- **Grid pipeline is two stages.** Stage 1: beat tracker → ticks. Stage 2: constant fit → (BPM, phase) with goodness-of-fit; the fit logic is shared across all Stage-1 candidates and is informed by Mixxx's const-region approach (fit constant regions, prefer integer BPM within a threshold, fractional otherwise). Unconditional integer snapping is removed.
- **Bail semantics (ADR 0024).** Poor fit ⇒ no Beatgrid, no BPM written, diagnostics stored, Track flagged needs-attention. No placeholder grid is generated from a dubious BPM.
- **Beat tracker candidates:** Essentia RhythmExtractor2013 ticks (baseline), madmom DBN; beat_this optional. TempoCNN as tempo-only cross-check (no phase).
- **Key candidates:** Essentia KeyExtractor profile sweep (edma, edmm, bgate, braw), libkeyfinder, madmom CNN key recognition.
- **Ground truth corpus** is assembled from data already in the library DB: imported Engine grids/keys and Rekordbox scalar key/BPM. Gold tier = Engine and Rekordbox agree (after notation conversion); disputed tier excluded from headline scores and emitted as a review list. Grid phase scoring is Engine-only. Hand-verified overrides promote disputed tracks to gold.
- **Scoring:** BPM correct within 0.05 with half/double-time as an explicit error class; phase error measured mod beat against Engine's grid; key scored MIREX-weighted with headline = mixable rate (exact + fifth + relative). Scoring functions are pure (ticks/values in, scores out).
- **Harness is offline scripts only.** No API endpoints, no frontend, no schema migrations in Phase A. Output: per-candidate score tables and per-track failure lists.
- **Phase B — app wiring.** The winning grid candidate becomes the native Analysis implementation. Analysis emits a Beatgrid with origin `analyzed`; BPM is the grid's projection via the existing grid-op write path (ADR 0016). Grid origin enum gains `analyzed`. Key gains a provenance field (`analyzed` / `imported` / `manual`).
- **Overwrite ladder** `generated < analyzed < imported < edited` (keys: `analyzed < imported < manual`) binds bulk and automatic runs only. A user-triggered single-track re-analysis overwrites freely.
- **Auto-analyze on acquisition** via the existing in-process task system (ADR 0003), like waveform generation. Re-analysis of existing tracks stays manual (per-track or bulk script).
- **Backfill:** after the winner lands, a bulk run rewrites analysis across the library respecting the ladder. Old BPM/key analysis rows are superseded and overwritten wholesale — no versioning (no-backward-compat stance).
- **Deferred within the analyzer:** variable-tempo grid detection (variable grids enter only via External Import), downbeat detection (analyzed grids carry no anchor; phase is "a beat", not "beat 1").

## Testing Decisions

- Tests exercise module interfaces, not internals (ADR 0002).
- **Scoring and fit logic are pure-function tested** with synthetic tick sequences: perfect constant ticks, jittered ticks, half/double-time ticks, genuinely variable ticks (must bail), fractional-BPM ticks (must not snap). No audio files, no heavy deps.
- **Corpus/tiering logic** tested with synthesized Engine/Rekordbox value pairs — agreement, disagreement, notation-conversion edge cases. No real Engine blobs in tests (ADR 0004 — synthesized fixtures).
- **Import hygiene guard** extends to new candidate deps: madmom/beat_this must not enter the app import chain (existing heavy-dep guard tests are prior art).
- **Phase B behavior tests** at the analysis/task seam: analyzed grid written with correct origin; bail path writes no grid/BPM and sets the flag; ladder respected on bulk, ignored on manual single-track; acquisition enqueues analysis. Candidate analyzer stubbed behind the interface — no real audio analysis in app tests.
- Candidate analyzers themselves are validated by the harness against the corpus, not by unit tests — the shootout *is* their test.

## Out of Scope

- Loudness/gain analysis (ReplayGain, LUFS, autogain)
- Cue/intro-outro detection
- Downbeat and phrase detection (analyzed grids are phase-anchored to a beat, not bar-aware)
- Variable-tempo grid *detection* (import of variable grids from Engine remains supported)
- Rekordbox performance data (grids/cues) import
- Export of analysis results to external libraries
- UI beyond surfacing the needs-attention flag as a library filter; no new analysis UI
- Waveform analysis changes (ADR 0014 blob unchanged)

## Shootout Verdict (2026-07-05, Phase A complete)

Winners, signed off: **madmom_dbn** for grids (851 gold tracks: 93.3% ok, phase median 4.3ms, 5.1% honest bail) and **madmom_keycnn** for keys (783 gold tracks: 93.0% mixable, 81.1% exact) — both from the one madmom dep. beat_this second on grids (85.7%); essentia baseline third everywhere; EDM-tuned essentia profiles (edma/edmm) lost to bgate on this corpus. Corpus reads Engine/RB DBs directly (read-only) rather than library-DB rows — deliberate deviation, covers never-imported tracks. Full numbers: issue 06 and `data/shootout_report.md` (lane `analysis`).

## Further Notes

- ADR 0024 records the constant-fit-or-bail decision and ground-truth scoring rationale; ADR 0016 governs grid/BPM authority; CONTEXT.md defines Ground truth corpus and Quantized track.
- Known reference points from prior work: Engine produced variable grids for ~32 tracks and >0.05 BPM drift on 2 constant-grid tracks (uninvestigated); these belong to the disputed/review flows, not gold scoring.
- Open issue "protect manual overrides" (analysis-curation 01) is subsumed by the overwrite ladder in Phase B.
- Existing benchmark/experiment scripts (TempoCNN, keyfinder comparisons, BPM method benchmarks) are superseded by the harness and may be deleted as part of Phase A.
- Phase A is lane-friendly: scripts plus read-only DB access, no hotspots. Phase B touches models/migrations and the analyze/task paths.

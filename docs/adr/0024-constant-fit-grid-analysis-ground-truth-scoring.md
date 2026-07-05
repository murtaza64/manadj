# Native grid analysis is a constant-tempo fit, scored against an external ground-truth corpus

Native beat analysis historically produced only a BPM number (integer-snapped, hand-tuned estimate ordering) because off-the-shelf beat trackers emit jittery tick sequences that, taken literally, yield wobbly variable-tempo grids — a domain mismatch with a library that is ~99% quantized EDM. We decided the analyzer's output artifact is a Beatgrid (origin `analyzed`), produced by fitting a constant grid (BPM + phase) to tracker ticks: ticks are evidence, never the grid. When the fit is poor the analyzer **bails** — no grid, no BPM (a BPM derived from ticks that don't fit a constant grid isn't trustworthy either), track flagged as a needs-attention worklist item. Variable-tempo *detection* is deliberately out of scope; variable grids enter only via External Import. BPM snapping becomes conditional (integer when within threshold, fractional otherwise), replacing the unconditional integer snap.

Accuracy is measured, not vibed: candidate analyzers (beat trackers and key backends alike) are scored against the Ground truth corpus — gold tier where Engine DJ and Rekordbox agree, disputed tier excluded until hand-verified; grid phase is Engine-only. Key error scoring is MIREX-weighted with "mixable rate" (exact + fifth + relative) as the headline metric.

## Consequences

- Native analysis and Engine import produce the same kind of artifact, so grid precedence doubles as BPM precedence (ADR 0016). The overwrite ladder is `generated < analyzed < imported < edited`; keys gain the same provenance (`analyzed`/`imported`/`manual`). The ladder binds bulk/automatic runs only — a user-triggered single-track re-analysis overwrites freely.
- New acquisitions auto-analyze via the task system; re-analysis of existing tracks stays manual.
- Unquantized tracks are a curated exception (manual grid or import), not something the analyzer guesses at.

# 07 — Analysis emits an analyzed Beatgrid

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Wire the winning grid analyzer (issue 06) in as native Analysis. A manual per-track analyze produces a Beatgrid with origin `analyzed` (new origin value); BPM becomes that grid's projection via the sanctioned grid write path (ADR 0016) — no more independent integer-snapped BPM writes. On bail: no grid, no BPM, fit diagnostics stored, Track flagged needs-attention. Old BPM-analysis evidence rows are superseded by the new diagnostics (overwrite, no versioning).

Demoable end-to-end: analyze a track in the app, see a correct grid and fractional-capable BPM; analyze an unquantized track, see the flag and no grid.

## Acceptance criteria

- [ ] Manual analyze writes a constant grid with origin `analyzed`; BPM is its projection
- [ ] Conditional snapping: integer BPM within threshold, fractional preserved otherwise
- [ ] Bail path: no grid/BPM written, diagnostics stored, needs-attention flag set
- [ ] Winning analyzer sits behind the same candidate interface the harness used
- [ ] Behavior tests at the analysis seam with a stubbed candidate (no real audio analysis); heavy-dep and import-hygiene guards pass
- [ ] Migration for grid origin value and needs-attention/diagnostics storage

## Blocked by

- 06

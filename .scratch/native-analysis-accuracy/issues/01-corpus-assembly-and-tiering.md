# 01 — Corpus assembly and tiering

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

An offline script that assembles the Ground truth corpus from the library DB: for each Track, gather Engine-imported grid/key and Rekordbox key/BPM scalars, convert notations, and assign tiers — *gold* where Engine and Rekordbox agree, *disputed* where they disagree, plus a bucket for tracks with Engine-only data (phase ground truth is Engine-only regardless). Emits a corpus artifact consumable by the harness (issues 02/03) and a human-readable disputed review queue. Hand-verified overrides (a simple editable file) promote disputed tracks to gold.

## Acceptance criteria

- [ ] Script outputs corpus with per-track ground-truth values and tier labels
- [ ] Key agreement computed after notation conversion (Engine key ID vs RB ScaleName), BPM agreement within 0.05
- [ ] Disputed review queue emitted (track, Engine value, RB value)
- [ ] Override file promotes disputed tracks to gold with the verified value
- [ ] Tiering logic covered by pure-function tests with synthesized value pairs (no real Engine blobs, ADR 0004)
- [ ] Read-only DB access; no schema, API, or UI changes

## Blocked by

None - can start immediately

## Comments

**2026-07-05 (agent, lane `analysis`, change vxoosvsv)** — Done. `harness/corpus.py` (pure tiering: per-field gold/disputed/engine_only/rb_only/missing, overrides promote to gold, Engine primary on gold), `harness/build_corpus.py` (CLI: `uv run -m harness.build_corpus`), overrides stub at `overrides.toml`, 24 pure-function tests. Real run over sandbox clone: 991 tracks — key gold 786 / disputed 135; bpm gold 855 / disputed 63; grid phase truth 989 (957 constant, 32 variable — matches PRD's known count). Artifacts: `data/corpus.json`, `data/corpus_disputed.md` (untracked). Full suite 563 passed; ruff clean; heavy-dep guard green. Unlocks issues 02 and 03. Not landed — awaiting approval.

**2026-07-05 (agent, post-review)** — Code review (standards + spec) applied: `FieldTruth[T]` collapses the per-field data clump; Engine BPM truth now `bpmAnalyzed`-only (rounded `bpm` column never used as truth — was a false-dispute risk); disputed queue prints full paths (override-file-ready); `DisputedRow` removed (queue returns entries). Corpus numbers unchanged (991 tracks; every Engine match had bpmAnalyzed). Spec deviation flagged for human: corpus reads Engine/RB DBs directly (read-only) rather than "data already in the library DB" per PRD — deliberate, covers never-imported tracks; PRD wording should be updated or the approach reverted. 24+539 tests green, ruff clean.

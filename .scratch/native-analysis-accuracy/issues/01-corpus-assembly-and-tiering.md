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

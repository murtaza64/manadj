# 05 — Key candidate: madmom CNN key recognition

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

madmom's CNNKeyRecognition as a key candidate behind the contract from issue 03, scored by the same harness. If madmom's key model is painful to run, substitute keycnn (Schreiber) and record the swap.

## Acceptance criteria

- [x] madmom key CNN (or keycnn substitute, with reason) scored alongside issue-03 candidates
- [x] Heavy deps absent from app import chain

## Blocked by

- 03

## Comments

**2026-07-05 (agent, lane `analysis`, change qvppvuul)** — Done. `MadmomKeyCNN` (CNNKeyRecognitionProcessor, label normalized "F# minor" → "F#m" for Key parsing). 150-gold-track result: **94.0% mixable / 78.7% exact / 0.849 weighted** — best mixable alongside keyfinder (93.3%), just under essentia_bgate on exact (80.0%) and weighted (0.853). Three-way race within noise at n=150; the full-corpus run in issue 06 decides.

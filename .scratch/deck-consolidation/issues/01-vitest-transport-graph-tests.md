# 01 — vitest safety net for playback semantics

Status: ready-for-agent

## Parent

`.scratch/deck-consolidation/PRD.md`

## What to build

Stand up vitest in the frontend (pure TS, no jsdom) and put the playback stack's pure modules under test, so the library port cannot silently change cue semantics.

- Transport reducer: full press/hold semantics — cue set while paused off-cue; hold-to-preview from cue and release-returns-to-cue; cue-up after play-pressed-during-preview keeps playing; cue-down while playing returns to cue and pauses; hot-cue jump while playing vs hold-to-preview while paused; seek while running restarts audio; `ended` during preview returns to cue, otherwise rests at end.
- Graph mappings: EQ value→gain (0 → exactly 0, 0.5 → exactly 1, 1 → +6 dB), sweep position→filter (deadzone → bypass, LP/HP frequency ranges and resonance).

No Web Audio mocking, no engine/renderer/view tests — pure modules only, per ADR 0002 and the PRD's testing decisions.

## Acceptance criteria

- [ ] `npm test` (or equivalent script in `frontend/package.json`) runs vitest and passes
- [ ] Transport reducer behaviors listed above each have a test, exercised through the reducer's public interface
- [ ] EQ and sweep mapping edge values are asserted exactly (kill = 0, flat = 1)
- [ ] No new test touches Web Audio, the DOM, or the network
- [ ] `make typecheck` and backend `pytest` stay green

## Blocked by

None - can start immediately.

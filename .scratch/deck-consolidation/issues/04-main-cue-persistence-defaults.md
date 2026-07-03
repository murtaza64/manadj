# 04 — Main cue: CDJ memory-cue behavior

Status: ready-for-agent

## Parent

`.scratch/deck-consolidation/PRD.md`

## What to build

Give the Main cue persisted, CDJ-style behavior across both views (glossary: Main cue).

- Engine `load()` accepts an initial cue point; the engine additionally computes the first non-silent position from the decoded buffer as its internal fallback.
- Default precedence when loading a Track: saved cue → first beat (caller supplies from the Beatgrid) → first non-silence (engine) → 0.0. Defaults are not persisted.
- Setting a cue (cue button while paused off-cue) persists through the existing waveform cue-point endpoint. Persistence lives in the React layer — it observes cue changes in the deck snapshot and fires the PATCH; the engine stays framework-free and API-ignorant.
- Both Library and Practice load flows pass the saved/first-beat cue; both benefit automatically.

## Acceptance criteria

- [ ] Setting a cue, reloading the app, and reloading the track restores the cue position
- [ ] A track with no saved cue and a Beatgrid cues at its first beat; without a Beatgrid, at the first non-silent audio; silence-only/edge cases fall back to 0.0
- [ ] Default cues (first-beat/non-silence) are not written to the backend until the user sets a cue
- [ ] The engine has no fetch/API knowledge; persistence code lives in the React layer
- [ ] Default-precedence logic is under vitest (pure), including the non-silence threshold behavior
- [ ] `make typecheck`, frontend lint on touched files, vitest, and backend pytest all green

## Blocked by

- 03-shared-deck-library-port-explicit-load

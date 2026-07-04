# 23 — Library view: loaded track is the single authority

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md`. Same principle as the discovery-unification
decision (Find Compatible reference = loaded deck, selection retired).

## What to build

Library-view panels still target the *selected* row where they should
target the *loaded* track:

- **Tag editing** targets the selected track.
- **Minimap navigation** (waveform minimap under the player) follows the
  selected track.

Both should respect the loaded track only — selection is for browsing and
Load, not a second implicit context. Audit the library view for any other
selection-driven panels while in there (the selected-vs-loaded drift keeps
producing bugs — see issue 24).

## Acceptance criteria

- [ ] Selecting rows while a track is loaded never changes what the tag
      editor edits or where the minimap seeks
- [ ] Tag edits apply to the loaded track; minimap clicks seek the loaded
      track
- [ ] With nothing loaded, panels are empty/disabled (not
      selection-driven)
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

# 29 — Swap track load order (A ⇄ B)

Status: ready-for-human (implemented, change zkloymkv — verify by eye: ⇄
button next to the play button; swap, check the reversed pair seeds its
own Transitions, swap back, original set intact)

## Parent

`.scratch/mix-editor/PRD.md`.

## What to build

A button in the Transition editor to swap the loaded pair: A's track goes
to deck B and vice versa. One gesture instead of two manual re-loads when
the pair is backwards ("actually I want to mix OUT of the other one").

Semantics (Transitions are directional — glossary):

- Swap re-loads both editor decks and mirrors onto the shared decks,
  exactly as two `assignTrack` calls would.
- The pair key reverses (`a:b` → `b:a`), so the session re-seeds from the
  REVERSED pair's saved Transitions per the normal `loadPair` rules —
  pending edits on the old direction flush first (store handles this);
  the new direction starts from its own saved set or a fresh pristine
  "Transition 1". A→B sketches are NOT mirrored into B→A — direction is
  meaning, not notation.
- Placement suggestion: the editor center panel, near the switcher
  (⇄ glyph, player-button idiom per issue 17).

## Acceptance criteria

- [ ] One click swaps both decks (editor + shared mirror), loads settle,
      playhead parks per the normal transition-load choreography — BY EYE
- [x] Saved Transitions for the ORIGINAL direction are untouched: swap is
      two assignTracks → pairKey reverses → store.loadPair (flush-before-
      reseed already pinned by editorStore tests)
- [ ] The reversed pair's own saved Transitions (if any) load; otherwise
      a fresh pristine session — BY EYE (store behavior tested)
- [x] Buffer reuse: swap costs zero re-decodes via issue 28's cache
- [x] Disabled when fewer than two tracks are loaded
- [x] tsc, eslint, vitest 217, build green (no store seam touched — swap
      is shell glue over assignTrack + loadPair)

## Blocked by

None. Synergizes with 28 (swap without the cache re-decodes both tracks).

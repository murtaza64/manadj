# 29 — Swap track load order (A ⇄ B)

Status: ready-for-agent (filed 2026-07-04 at the user's request)

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
      playhead parks per the normal transition-load choreography
- [ ] Saved Transitions for the ORIGINAL direction are untouched (flushed,
      not lost — verify by swapping back)
- [ ] The reversed pair's own saved Transitions (if any) load; otherwise a
      fresh pristine session (no trace unless edited)
- [ ] Buffer reuse: with issue 28's cache, a swap costs zero re-decodes
      (works without 28, just slower)
- [ ] Disabled when fewer than two tracks are loaded
- [ ] tsc, eslint on touched files, vitest green (store-level test for
      the flush-then-reseed sequence if a store seam is touched)

## Blocked by

None. Synergizes with 28 (swap without the cache re-decodes both tracks).

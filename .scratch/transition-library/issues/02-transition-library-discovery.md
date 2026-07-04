# 02 — Transition library: discovery marks and filter in the library view

Status: ready-for-human (implemented 2026-07-03, change `mwqvwots`; verify
marks/stars/filter in the browser. Note: favorite→star updates ride the
300ms debounced save — near-live)

## Parent

`.scratch/transition-library/PRD.md`. Glossary: Transition library,
Preferred pair.

## What to build

Surface saved-Transition knowledge in the library panel while decks are
loaded:

- **Direction-aware index** over stored Transitions:
  `transitionsFrom(trackId)` / `transitionsInto(trackId)`; prototype scale
  = in-memory scan of localStorage, rebuilt on editor save/delete events.
  Only materialized Transitions count (issue 20's lazy persistence keeps
  pristine ones out by construction).
- **Row marks**: for each library row, a compact glyph per loaded deck
  whose track has a saved Transition INTO that row's track (outgoing from
  A and/or from B — alternating-deck workflow). Glyph in the source deck's
  accent color; starred variant when that ordered pair is Preferred (≥1
  favorited Transition). No counts in v1.
- **Filter**: "has transition from loaded decks" toggle in the existing
  library filter bar. Design the toggle's state as a first-class filter
  axis — issue 03 binds a second control to it (Find Compatible modal
  switch) and requires compatible-criteria application to preserve it.
- Marks update live on load/unload, save, favorite, delete.

## Acceptance criteria

- [ ] Load a track into A: rows it has materialized Transitions into show
      the A-colored glyph; same for B; both marks can coexist on one row
- [ ] Favoriting a Transition upgrades the pair's glyph to the starred
      variant everywhere, live
- [ ] Filter shows exactly the marked rows; off restores the full view
- [ ] Merely-opened (pristine) pairs never produce marks
- [ ] Direction correctness under vitest (A→B saved does not mark the
      reverse)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

- `01-transition-switcher-lazy-persistence.md` (favorite flag +
  materialization rules feed the index)

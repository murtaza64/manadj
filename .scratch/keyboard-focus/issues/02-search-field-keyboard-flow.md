# Search field keyboard flow

Status: ready-for-agent

## Parent

`.scratch/keyboard-focus/PRD.md` (decisions 5–6)

## What to build

End-to-end: `Cmd+F` from anywhere focuses the library search with the
existing query selected; type to replace, Enter or Escape returns the
keyboard to the decks with the filter applied; Escape again clears the
filter. Modal/popover Escape is never swallowed by the filter.

- FilterBar search input: Escape → blur (filter kept, stopPropagation);
  Enter → blur (PRD 5).
- `Cmd+F` → focus + select-all; preventDefault (browser find) (PRD 6).
  Works in every view that renders the browse surface (library,
  Performance, Transition editor's embedded panel).
- Staged clear: `clearSearch()` beside FilterContext; Escape cases in the
  library hub, PerformanceView handler, and TransitionEditor handler call
  it when no typing target is focused and the filter is non-empty
  (PRD 6).
- Verify SaveTemplateModal / TagPopover Escape stops propagation; add it
  where missing.

## Acceptance criteria

- [ ] Cmd+F focuses search from library, Performance, and the editor;
      existing text is selected; browser find never opens
- [ ] Escape in the field blurs and keeps the filter; Enter does the same
- [ ] Escape with the field unfocused and a filter active clears the
      filter — in all three views
- [ ] Escape with a modal/popover open closes it and does NOT clear the
      filter
- [ ] Transport keys (Space, j/k, 1–8) work immediately after Enter/
      Escape from the field
- [ ] vitest where the seams allow (clearSearch behavior, the staged-
      escape predicate if extracted); manual pass for the modal ordering
- [ ] Full gate green

## Blocked by

- `01-controls-stop-stealing-focus.md` (shares the guard changes; land
  order avoids conflicts in performanceKeys/useKeyboardShortcuts)

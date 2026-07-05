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

## Comments

**Done** (kbfocus lane, change pzxrqxou — keyboard-focus: 02-search-field-keyboard-flow)

Built:
- `components/searchKeys.ts`: `isFindChord` (Cmd/Ctrl+F, no extra
  modifiers), `shouldClearSearch` (staged-Escape rule: Escape, unmodified,
  active search, no typing target), and `useSearchKeys` — one document
  bubble-phase listener that focuses + select-alls the search on Cmd+F
  (preventDefault suppresses browser find) and calls `clearSearch()` on a
  staged Escape. Mounted by FilterBar, which every browse surface renders
  (library, Performance, editor's embedded panel) — the rule lives once
  and covers all three views without per-hub wiring.
- `FilterContext.clearSearch()`: clears search only, other axes untouched.
  FilterBar mirrors external clears into the field via adjust-during-render
  (debounce untouched).
- Search field: Enter and Escape blur (preventDefault + stopPropagation),
  filter KEPT.
- Escape ordering (modals beat the staged clear): BpmModal,
  CircleOfFifthsModal, FollowParamsModal moved from window-bubble to
  document-capture + stopPropagation; ContextMenu's Escape likewise;
  SaveTemplateModal got a document-capture Escape (cancels from any focus,
  not just the name input — its input-level handler removed). TagPopover
  already stopped propagation (React root — beats document bubble);
  AutoBlurSelect Escape already stops propagation (issue 01).

Tests: 11 new in `searchKeys.test.tsx` — chord + staged-rule tables, and
hook integration through a real FilterProvider (Cmd+F focuses + prevents
default; staged Escape clears search and keeps other filters; no-op when
search empty; an upstream capture stopPropagation starves the clear).
localStorage stubbed (vitest's jsdom bridge doesn't expose it).

Manual pass still needed (listed in .lanes/kbfocus.md): modal-ordering by
hand, Cmd+F in all three views, transport keys after Enter/Escape.

Gate: 739 vitest / 51 files, frontend build, 547 pytest, one alembic head
(0018), eslint on touched files (two pre-existing baseline items:
react-refresh export errors in ContextMenu/FilterContext, exhaustive-deps
warning on FilterBar's debounce — all present at main).

# Handoff: implement keyboard-focus hygiene

Goal: implement `.scratch/keyboard-focus/` — stop native controls from
stealing keyboard focus, and give the library search a keyboard exit.
Both issues, in order; frontend-only.

## Read first

1. `.scratch/keyboard-focus/PRD.md` — all six grill decisions, risks,
   claims. Do not re-litigate the decisions; the grill is done.
2. `.scratch/keyboard-focus/issues/01-controls-stop-stealing-focus.md`
   then `issues/02-search-field-keyboard-flow.md`.
3. Code you'll touch — orient before editing:
   - `frontend/src/components/performance/performanceKeys.ts`
     (`isTypingTarget` — the guard to narrow; its header documents the
     keydown/keyup asymmetry, preserve it)
   - `frontend/src/hooks/useKeyboardShortcuts.ts` (library hub; inline
     guard at ~L69-73 to unify; Space at ~L128)
   - `frontend/src/components/TopBar.tsx` (mode buttons + hosts
     `AudioRoutingPicker`), `components/AudioRoutingPicker.tsx` (the two
     selects)
   - `frontend/src/editor/TransitionEditor.tsx` (capture keydown handler
     ~L480; SELECT exemption stays; tempo-match/snap checkboxes;
     add-lane select), `editor/TransitionSwitcher.tsx` +
     `editor/TemplatesDropdown.tsx` (onBlur confirm reset → timeout)
   - `frontend/src/components/FilterBar.tsx` (search input, ~L144) +
     FilterContext (clearSearch home)
   - Precedents to match, not reinvent: `deckControls/BpmControl.tsx`
     (mousedown-preventDefault L305, Enter/Escape blur),
     `performance/TagPopover.tsx` (popover Escape).

## Key context not in the PRD

- `tabIndex={-1}` does NOT stop click-focus — the working mechanism is
  `preventDefault()` on mousedown (buttons/checkboxes) and blur-on-change
  (selects; mousedown-preventDefault stops a select's picker opening).
- The narrowed guard means a focused checkbox no longer silences hubs —
  that's the point; the global rule prevents the focus in the first
  place, the guard makes leaks non-fatal.
- PerformanceView deliberately claims Space with preventDefault
  (performance-mode issue 04 — Space is UNBOUND there by decision; don't
  bind it).
- `/` is deck B pad 4 (`performanceKeys.ts` DECK_KEYS) — untouchable.

## Hazards

- The global mousedown rule hits every button at once: the PRD's
  click-around list is part of slice 1's gate. Watch BpmControl (already
  has a local mousedown-preventDefault — must not conflict) and any
  control whose behavior secretly depends on focus (the two confirm
  buttons are the known cases).
- Escape ordering: modals/popovers must beat the staged filter-clear.
- React StrictMode: mount-effect listeners must pair setup/cleanup (this
  repo has history here — see headphone-cue 06 lessons if curious).

## Process

- Fresh lane per `docs/agents/parallel-work.md`: `jj workspace add --name
  kbfocus -r main ../manadj-kbfocus`, register `.lanes/kbfocus.md` (pick
  an unused port offset; likely unused — frontend tests only, no DB).
  One jj change per issue: `keyboard-focus: <issue-stem>`.
- Gate per lane doc: `npx vitest run` + `npm run build` (in `frontend/`,
  `npm install` first — fresh workspace), `uv run -m pytest`, `uv run
  alembic heads` (expect untouched), ruff on touched files (none —
  frontend only). Land at issue boundaries (`jj bookmark move main --to
  <head>`), rebase + re-gate if trunk moved.
- Append a Done comment to each issue file in the landing change; note
  the click-around results.
- Human verification at the end: leave the lane registered with a status
  line listing what to hand-test (mode toggle + Space; device pick +
  Space; checkbox + Space; Cmd+F/Escape flow; modal Escape).

## Suggested skills

- `implement` (primary), `tdd` for the pure seams (guard predicate,
  useConfirmFlag, staged-escape predicate), `code-review` per slice
  (two-axis, as this repo runs it).

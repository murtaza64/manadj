# PRD: Keyboard focus hygiene

Feature slug: `keyboard-focus`
Grill: 2026-07-05 (post editor-shared-decks). Frontend-only; no ADR — all
decisions reversible.

## Problem

Native controls steal keyboard focus and break the keyboard-first
transport surface:

- Clicking a `<button>` (TopBar mode toggles — present in every view) or
  `<select>` (audio device pickers, editor add-lane) leaves it focused;
  Space then re-activates the control instead of play/pause.
- Worse: the hubs' shared guard (`isTypingTarget`,
  `components/performance/performanceKeys.ts`) treats ANY `INPUT` as
  typing — a focused checkbox (editor tempo-match/snap) silences every
  transport key, invisibly.
- The library search input (`components/FilterBar.tsx`) has no keyboard
  exit at all: once focused, all transport keys are dead until you click
  elsewhere.

## Decisions

1. **Global no-focus rule** — one `mousedown` listener (capture phase) at
   app root: `preventDefault()` when the target (or closest ancestor
   control) is a `button` or `input[type=checkbox|radio|range]`, unless
   it carries a `data-focusable` opt-out. Click still activates; focus
   never moves. One enforcement site: future buttons are covered by
   default (the arbiter lesson — a policy wants one owner, not per-
   consumer fixes).
2. **Hub guard narrowed** — `isTypingTarget` matches only genuinely
   type-y targets: `TEXTAREA`, `contentEditable`, and `INPUT` whose type
   is text-like (text/search/number/url/email/password). The inline
   duplicate of this check in `hooks/useKeyboardShortcuts.ts` routes
   through the shared guard. Hubs `preventDefault()` the Space they
   handle (defense in depth if a control ever opts out).
3. **`AutoBlurSelect`** — a thin `<select>` wrapper that blurs itself on
   `change` and on Escape (selects can't use the mousedown trick — it
   stops the picker opening). Used by: the two audio device pickers
   (`components/AudioRoutingPicker.tsx`) and the editor's add-lane
   select. Modal selects (SaveTemplateModal) stay plain; the
   TransitionEditor's SELECT exemption in its capture handler stays.
4. **Delete-confirm disarm by timeout** — TransitionSwitcher and
   TemplatesDropdown reset their "confirm?" state `onBlur` today, which
   dies with the no-focus rule. Replace with a ~3s auto-disarm via a
   shared `useConfirmFlag` hook (strictly better: today an armed confirm
   sticks until something else takes focus).
5. **Search field keys** — Escape blurs the FilterBar search (filter
   KEPT — clearing is a separate act; `stopPropagation`). Enter also
   blurs (search is live/debounced; BpmControl set the Enter-commits-and-
   blurs precedent).
6. **`Cmd+F` focuses the search** and selects the existing text (typing
   replaces the old query); `preventDefault` suppresses browser find.
   **Staged Escape clears**: Escape while unfocused with an active filter
   clears it — a `clearSearch()` owned beside FilterContext, called from
   each view hub's Escape case (library hub, PerformanceView,
   TransitionEditor — one line each; the rule lives once). `/` is NOT
   available (deck B pad 4 — the drop cue).

## Out of scope

- Rebinding `/` or any pad keys.
- Focus styling (mix-editor issue 17 covered visuals).
- Custom knob/fader widgets (never focusable — they're divs).

## Risks / verification

- The global rule changes every button at once → a click-around pass is
  part of slice 1's gate: TopBar toggles, FilterBar chips, PFL/Key
  Lock/MATCH, editor checkboxes + TransitionSwitcher/TemplatesDropdown
  (rename inputs must still focus normally — they're text inputs, not
  covered by the rule), BpmControl dropdown (already uses the mousedown
  trick locally — must not double-break).
- Focus-dependent behaviors are the regression class; the two confirm
  buttons are the known cases, the click-around hunts unknowns.
- Modal/popover Escape (SaveTemplateModal, TagPopover) must win over
  staged filter-clear — verify handlers stop propagation, add where
  missing.

## Process

Repo conventions: jj lane per `docs/agents/parallel-work.md`; change per
issue, `keyboard-focus: <issue-stem>`; gate = pytest + vitest + frontend
build + single alembic head (frontend-only feature — pytest/alembic
should be untouched). Claims: `frontend/src/components/**` (TopBar,
FilterBar, AudioRoutingPicker, performance/*), `frontend/src/hooks/
useKeyboardShortcuts.ts`, `frontend/src/editor/` (TransitionEditor,
TransitionSwitcher, TemplatesDropdown). Check `.lanes/` before starting.

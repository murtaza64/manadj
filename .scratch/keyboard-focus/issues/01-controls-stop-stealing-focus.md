# Controls stop stealing focus

Status: ready-for-agent

## Parent

`.scratch/keyboard-focus/PRD.md` (decisions 1–4)

## What to build

End-to-end: click any button, checkbox, mode toggle, or audio dropdown,
then press Space — playback toggles on the audible surface; the control
you clicked neither re-activates nor silences the hubs.

- The global no-focus rule (PRD decision 1): app-root `mousedown` capture
  listener, `preventDefault()` for `button`/`input[type=checkbox|radio|
  range]` targets without `data-focusable`. Mount it once where the app
  root lives.
- Narrow `isTypingTarget` to text-like targets and route
  `useKeyboardShortcuts`'s inline guard through the shared one (PRD 2);
  hubs preventDefault the Space they handle.
- `AutoBlurSelect` (PRD 3) replacing the audio device pickers' and
  add-lane's plain selects.
- `useConfirmFlag` timeout-disarm hook (PRD 4) replacing the onBlur reset
  in TransitionSwitcher and TemplatesDropdown.

## Acceptance criteria

- [ ] Clicking a TopBar mode toggle, then Space: play/pause fires; the
      mode does not re-toggle
- [ ] Picking an audio output device, then Space: play/pause fires
      (select blurred on change); Escape while a select is focused blurs
      it
- [ ] Toggling tempo-match/snap in the editor, then Space: editor
      play/pause fires; the checkbox does not re-toggle; no transport key
      is dead afterwards
- [ ] Delete buttons still confirm-then-delete; the armed state disarms
      by itself (~3s); no reliance on focus
- [ ] Text inputs (search, rename fields, BPM) still focus and type
      normally; `data-focusable` opt-out works
- [ ] vitest at the pure seams: the narrowed guard predicate (table of
      targets), `useConfirmFlag` (fake timers), and the no-focus rule's
      target predicate if extracted (recommended)
- [ ] Click-around pass from the PRD's risk list performed and noted in
      the Done comment
- [ ] Full gate green

## Blocked by

None — can start immediately.

## Comments

**Done** (kbfocus lane, change owsrywmy — keyboard-focus: 01-controls-stop-stealing-focus)

Built:
- `focus/noFocusRule.ts`: capture-phase `mousedown` `preventDefault()` at the app
  root for button / checkbox / radio / range targets (labels resolve to the
  control they wrap), `data-focusable` opt-out on the control or an ancestor.
  Mounted once in `App.tsx` (paired setup/cleanup — StrictMode-safe).
- `isTypingTarget` narrowed to TEXTAREA / contentEditable / text-like INPUT
  (text, search, number, url, email, password); predicate extracted as
  `isTextEntryTarget` for tests. `useKeyboardShortcuts` inline guards (keydown
  + keyup) now route through it; library hub claims Space (preventDefault)
  even when the deck can't act yet.
- `AutoBlurSelect` (blur on change; blur + stopPropagation on Escape) used by
  both AudioRoutingPicker selects and the editor add-lane select. Modal select
  (SaveTemplateModal) stays plain; editor SELECT exemption untouched.
- `useConfirmFlag` (~3s timeout disarm, timer as an effect of the armed state)
  replaces onBlur confirm resets in TransitionSwitcher + TemplatesDropdown;
  TransitionSwitcher's per-Transition navigation reset calls `disarm()`.

Tests: 36 new (noFocusRule predicate + install, isTextEntryTarget table,
useConfirmFlag with fake timers; jsdom added as a dev dep with per-file
`@vitest-environment` pragmas — other tests stay node).

Click-around (code-level; hand-pass listed in .lanes/kbfocus.md):
- TopBar toggles, FilterBar chips/x-buttons/follow toggles, PFL/Key Lock,
  tag chips: plain onClick buttons — no focus dependence found.
- FilterBar energy drag + BpmControl dropdown options are divs — outside the
  rule; BpmControl's local mousedown-preventDefault does not overlap it.
- Editor tempo-match/snap: label-wrapped checkboxes — rule resolves the label
  press to the checkbox; onChange still fires on click.
- Rename inputs (switcher/templates/playlists) are text inputs — still focus.
- Known behavior change (accepted): text inputs no longer blur when a
  *button* is clicked (focus doesn't move), so blur-commit fields (BpmControl
  draft, EditableCell, playlist rename) commit via Enter or a click on
  non-button surface instead.

Gate: 728 vitest / 49 files, frontend build, 547 pytest, one alembic head
(0018), eslint clean on touched files.

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

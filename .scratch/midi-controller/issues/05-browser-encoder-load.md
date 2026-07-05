# 05 — Browser: encoder selection + LOAD A/B

Status: done (hardware-verified by Murtaza 2026-07-05)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

- Browser encoder rotation moves the library row selection (relative
  ticks, reusing issue 03's decoding); encoder press unmapped.
- LOAD A / LOAD B invoke the existing Load path onto the respective Deck,
  including the load lock (refused onto a playing Deck, silently — no
  hardware feedback channel).
- Browse/load actions act on the active browse surface's selection and
  no-op where there isn't one (PRD scope decision).

## Acceptance criteria

- [ ] Encoder scrolls the library selection both directions, sane speed
- [ ] LOAD A/B loads the selected track onto the right deck; refused on a
      playing deck with no crash or state corruption
- [ ] In a view with no browse surface, encoder/load are silent no-ops
- [ ] Selection-move + load action resolution under vitest
- [ ] make typecheck, eslint, vitest green

## Blocked by

- 01-foundation-transport-cue (03 for tick decoding if not yet landed —
  coordinate)

## Comments

- Browse surface: Library registers its existing LibraryBrowseHandle shape
  (navigate/getSelectedTrack) module-level on mount (controlRegistry stack;
  most recent mount wins, so embedded Library instances in Performance/
  Transition views work unchanged). Views with no Library mounted: encoder
  and LOAD are silent no-ops.
- Encoder reuses issue 03's relative tick decode; dispatch steps navigate()
  once per tick, capped at 8 steps/message against runaway bursts.
- LOAD honors the load lock (isAudioRunning || pendingPlay → silent refuse),
  implemented in the registrar's load handler — one view-blind policy.
- Encoder press stays unmapped per the issue.

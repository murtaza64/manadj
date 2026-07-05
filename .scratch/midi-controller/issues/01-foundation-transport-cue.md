# 01 — Foundation: adapter + translator seam + transport/cue end-to-end

Status: done (implemented, change zprmmplk; hardware-verified against the physical MK2, change xrunwzzz — PLAY/CUE on both decks confirmed, full learned mapping applied, MIDI inspector added at /midi-inspect)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

The whole MIDI pipeline, thin: plug in the Inpulse 300 MK2 and its
play/pause and CUE buttons drive both Decks.

- **Adapter**: Web MIDI permission request, port discovery, match a
  connected input port to a Mapping by port-name substring, hot-plug
  reconnect via state-change events. Attaches once at the app provider
  level (above the view switch).
- **Translator** (the tested seam): raw MIDI messages + a Mapping in,
  domain actions out. This slice: note on/off → button down/up edges,
  mapping resolution, unmapped-message silence. (14-bit, relative ticks,
  modifiers, velocity land in later slices — leave seams, not code.)
- **Action vocabulary + handlers**: closed action type; this slice
  implements transport toggle and cue down/up per deck, dispatching to the
  existing Deck engine methods the keyboard uses (never synthetic key
  events).
- **Inpulse mapping file**: typed module with port-name match + bindings
  for play/pause and CUE on both decks (note/CC numbers established
  empirically against the device — they live only here).

## Acceptance criteria

- [ ] Plug in device → recognized without config; play/pause toggles each
      Deck; CUE has full on-screen semantics (set-when-paused,
      return-to-cue, hold-to-preview)
- [ ] Unplug/replug mid-session recovers without reload
- [ ] Works from the library view mid-mix (layer lives above the views)
- [ ] Unmapped messages are silent no-ops
- [ ] Translator under vitest: synthetic messages in → asserted action
      streams out (edges, resolution, silence); no Web MIDI mocking
- [ ] make typecheck, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

# 02 — Hot cue pad lights

Status: ready-for-agent

## Parent

`.scratch/midi-pad-leds/PRD.md`

## What to build

Pads 1–8 light when their hot cue slot is assigned on the loaded Track, dark
when empty — for both decks, in HOTCUE base-layer mode only (pad modes are
note-isolated on this device; never write other modes' addresses).

- Pad LED addresses per deck join the Mapping's feedback section (Mixxx-
  sourced).
- The feedback bridge subscribes to the same hot cue query the on-screen
  pads render from, so screen and hardware cannot drift; resync on Track
  load (including boot restore), hot cue set/delete (from screen or from a
  hardware pad press), and empty deck (all eight off).
- Round-trip LED lag after a hardware pad-set is accepted (PRD: optimistic
  update is a flagged follow-up).

## Acceptance criteria

- [ ] Loading a Track lights exactly its assigned slots; unloading/empty
      deck → all pads dark
- [ ] Setting a hot cue from a hardware pad lights that pad (after the
      mutation round-trip); deleting on screen darkens it
- [ ] Pad lights correct immediately on connect/replug
- [ ] Other pad modes' lights untouched
- [ ] ledStates coverage for pad derivation under vitest
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-output-seam-play-led

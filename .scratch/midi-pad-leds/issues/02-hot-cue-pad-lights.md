# 02 — Hot cue pad lights

Status: ready-for-human

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

## Comments

- 2026-07-04 (padleds lane): implemented in jj change `qzzrzxnv`. Pads
  derive from the same `useHotCues` query cache the on-screen pads render
  (screen and hardware cannot drift; optimistic mutation updates included);
  HOTCUE base-layer addresses only (0x96/0x97 notes 0x00-0x07, velocity
  0x7e lit — Mixxx ground truth). Status → ready-for-human: HARDWARE SMOKE
  TEST — load a track with hot cues (exact slots lit), set a cue from a
  hardware pad (pad lights), delete on screen (pad darkens), unload/empty
  deck (all eight dark), switch pad mode (other modes' lights untouched),
  replug (pads correct immediately).

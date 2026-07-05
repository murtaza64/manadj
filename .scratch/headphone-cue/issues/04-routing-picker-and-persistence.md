# 04 — Routing picker + persistence

Status: ready-for-agent

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

Product UI over issue 01's plumbing:

- A routing picker in the app chrome (top bar or the performance view's
  middle strip — implementer's choice of the two): Master bus device and
  Cue bus device, each any enumerated output (Mac speakers, Mac-jack
  headphones, Inpulse interface, "off" for cue).
- Persistence: device id + label per bus survive restarts; on boot,
  re-resolve by id — missing master device falls back to the system
  default, missing cue device disables the Cue bus. Audio must never be
  dead because a saved device is gone.
- Mid-session device disappearance tears the bridge down safely (master
  never at risk); picking it again rebuilds.

## Acceptance criteria

- [ ] Both buses routable from the picker; changes take effect live
- [ ] Restart restores the routing; unplugged saved cue device → cue
      disabled, master on default, no errors
- [ ] Unplugging the cue device mid-session: master keeps playing
- [ ] Routing-resolution edge cases under vitest (extends issue 01's pure
      function)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 02-cue-bus-pfl-end-to-end

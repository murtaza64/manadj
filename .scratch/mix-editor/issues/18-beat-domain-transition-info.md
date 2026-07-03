# 18 — Transition info in beats: toggleable beat/time readouts

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md`. Companion to the beat-domain direction
(templates §, deck slides §); ADR 0010 unaffected — model stays seconds,
beats are a display/input affordance.

## What to build

A beats ⇄ time toggle for the center panel's transition window numbers
(start, length, entry):

- Each value converts on its own track's beatgrid: start and length on the
  outgoing track's grid, entry on the incoming track's (correct even
  without tempo match).
- Toggle affects display AND input: in beat mode, typed values are beats
  (fractional allowed) converted to exact seconds at commit; in time mode,
  behavior unchanged.
- Display fractional beats to one decimal (values may sit off-grid by
  design).
- Per-value fallback: if that track lacks a beatgrid, show time for that
  field with a subtle marker; the toggle still switches the others.
- Toggle state persists with the editor's localStorage prefs.

## Acceptance criteria

- [ ] Toggle switches start/length/entry between seconds and beats; values
      round-trip exactly (toggle back and forth changes nothing)
- [ ] Beat-mode input of whole beats lands exactly on the grid (verify
      against beat guides); fractional input honored
- [ ] Entry uses the incoming track's grid — correct under tempo match off
- [ ] Gridless track degrades per-value to time with indicator
- [ ] Conversion helpers pure + under vitest (both grids, fractional,
      round-trip)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately. Coordinate with issue 17 (same inputs being
restyled).

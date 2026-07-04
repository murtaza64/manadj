# 02 — One BPM control over the projection model

Status: ready-for-agent

## Parent

`.scratch/deck-controls/PRD.md` (curation class); ADR 0016.

## What to build

One shared BPM component replacing the three idioms (library `BpmInput`
with octave dropdown; PERF uncontrolled input + ½/×2; editor draft-state
input):

- Displays the PROJECTED BPM (grid-dominant when a grid exists);
  variable grids read `~N (var)` and are not editable.
- Edit commits through slice 01's server op — the client-side
  PATCH→delete→regenerate ritual is deleted from all three call sites.
- Feature union, density-parameterized: octave/suggestion affordances
  (library's) and ½/×2 (PERF's) available where space allows
  (`perf-mini`-style modifier hides the long tail); ±0.03 micro-nudge
  kept (library keyboard parity).
- Effective-BPM readout (base × pitch × bend / editor rate) stays a
  per-surface concern beside the control, not inside it.

## Acceptance criteria

- [ ] Library, PERF deck panels, and editor DeckCards all render the
      shared component; the three old inputs are gone
- [ ] Rapid ±0.03 nudges stay serialized/visible (issue mix-editor/24's
      regression, now guaranteed by the server op — verify by eye)
- [ ] Variable-grid track: readout only, no input, in all modes
- [ ] tsc, eslint, vitest green; component snapshot/behavior tests at the
      commit seam (fake api)

## Blocked by

- 01 (server op).

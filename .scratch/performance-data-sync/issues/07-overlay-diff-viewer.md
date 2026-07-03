# Overlay diff viewer

Status: ready-for-agent

## Parent

`.scratch/performance-data-sync/PRD.md`

## What to build

The visual half of the confirm step: opening a diverged performance-data row (or a confirm-list entry) shows the track's waveform — one waveform, since both sides describe the same audio — with two color-coded overlay layers: both Beatgrids as tick/line overlays, both Hot Cue sets as markers carrying slot number, color, and label, and both Main cues. Zoomable to beat level so grid-vs-transient alignment is visible. Read-only comparison plus pick-a-side import actions (the same fill/replace/overwrite verbs the cells already expose) — explicitly not a grid editor; set-downbeat/nudge stay on the Deck panels.

The overlay's beat-position math must walk the **full** tempo-change list — a viewer that mis-renders variable grids would show false misalignment on exactly the tracks where the grid decision matters most. (Deck/waveform renderers keep their first-tempo-change limitation; that follow-up is out of scope.) Uses the track's existing 3-band waveform data.

## Acceptance criteria

- [ ] Diverged hot cue / beatgrid / main cue rows open the overlay viewer from the sync flow
- [ ] Both sides' grids, cue sets, and main cues render color-coded on one waveform with a legend distinguishing Library vs Engine
- [ ] Zoom reaches beat level; grid overlays are computed from the full tempo-change list (verified for a variable grid)
- [ ] Pick-a-side actions apply the existing import verbs and respect the confirmation rule
- [ ] No editing affordances in the viewer
- [ ] Pure overlay math (beat positions from tempo changes, marker layout) unit-tested on the frontend vitest seam; rendering eye-verified
- [ ] Typecheck and both test suites pass

## Blocked by

- 04-hotcue-divergence-and-import
- 05-beatgrid-maincue-divergence-and-import

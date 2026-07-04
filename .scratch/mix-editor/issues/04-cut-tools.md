# 04 — Cut tools: lane chop stamp + zero-length Transition shortcut

Status: done (2026-07-03, user-verified; 20ms walls centered on beatlines.
Note: shift+click's 1-beat interval uses the VISIBLE guides, so at low zoom
a culled grid makes the cut span the visible interval, not one true beat.
FOLLOW-UP 2026-07-03: the zero-length "cut" BUTTON was removed same day —
"not very useful in its current iteration" (user) — revisit the shortcut's
design later. The model behavior stands: durationSec = 0 still hard-cuts,
reachable via the length input; the chop stamp is unaffected.)

## Parent

`.scratch/mix-editor/PRD.md` (Editor tools). Prototype iteration — lands in
`frontend/src/prototype/` (MixEditorProto), logged in NOTES.md.

## What to build

Two small authoring tools in the Transition editor:

- **Chop stamp**: shift+drag on any lane (fader or EQ) inserts a rectangular
  full-cut between the beat-snapped drag edges — 4 breakpoints, value → 0
  with near-vertical walls. Shift+click = 1-beat cut at the clicked beat.
  Pure `LanePoint[]` insertion: resulting points are editable/deletable like
  hand-drawn ones. Lanes remain transition-window-only.
- **Zero-length shortcut**: a "cut" button in the transition controls that
  sets duration to 0 with the start beat-snapped (model already treats
  zero-length as a hard cut).

## Acceptance criteria

- [ ] Shift+drag on the incoming-fader lane over ~2 beats produces a clean
      2-beat full cut aligned to the beat guides; shift+click a 1-beat cut
- [ ] Works on EQ lanes (2-beat bass kill)
- [ ] Inserted breakpoints drag/delete like any others; lane clear resets
- [ ] "Cut" button collapses the Transition to zero length on a beat; playback
      hard-swaps A→B there
- [ ] Beat snapping uses each side's correct grid (B via tempo-stretch
      mapping, as the existing lane guides do)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately.

# 03 — Pure planner + overview ladder

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

The pure planner module — the feature's single new test seam: `plan(set, pins, track facts) → deterministic playback plan`. Per entry: deck (ping-pong parity), entry/exit in track time, outgoing window, incoming overlap, mix-time offset; hard cuts for unresolved adjacencies (outgoing to end, incoming from Main cue; first track starts at Main cue). Take pins plan through the existing vectorizer (idealized Transition computed at plan time, never snapshotted). All Set-playback semantics live here; test exhaustively in the mold of the mix-model/vectorizer suites.

On top of the planner: the **overview ladder** from the prototype verdict (variant D — see NOTES.md next to the prototype in the sets lane; reimplement fresh, do not promote prototype code). Zoomed staircase minimap above the Set list: mirrored deck lanes around a center line (A grows up, B hangs down), title strips outside the waveform on the outer edge, hot cues (faint line + triangle) on the title side, transition/take bands, hard cuts as dashed red blade + ✕. Ladder and list scrolls pinned to one progress value (list scroll fraction ↔ ladder scroll fraction — pure centering fails at the edges). Per-row "plays m:ss of m:ss"; set length in the toolbar.

## Acceptance criteria

- [ ] Planner is pure, side-effect free, and covered: parity, windows, mix offsets, hard cuts, Main-cue starts, take vectorization delegation
- [ ] Ladder renders all pin states distinctly; hard cuts unmissable
- [ ] Ladder/list scrolls stay pinned; list top ⇒ set start flush left, list bottom ⇒ set end flush right
- [ ] Per-row played durations and total set length agree with the plan

## Blocked by

- 02-adjacency-pins-evidence

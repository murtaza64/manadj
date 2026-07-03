# 12 — Deck slides: deck A controls (mirrored execution)

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md` (Deck slides). Glossary: Slide, Locked window,
Sketch origin. Prototype iteration.

## What to build

Deck A's hot cue and beat jump slide controls. A is pinned to the sketch
origin, so A-side gestures execute as their mirror (PRD table):

- Unlocked A-slide mutates `startSec` (mirrored sign); locked mutates
  `bInSec` (mirrored, ×rateB) — both via the slide math module from 06.
- **Playhead rule**: A-slides move the playhead by the mirrored delta so it
  stays pinned to B's content — A-hotcue lands the playhead literally on
  the cue; only deck A re-cues.
- Deck A hot cue buttons + beatjump controls (same idiom as 06, A's own
  beats).
- Signature gestures must land (from the PRD): playhead at window start +
  A-cue unlocked = transition relocates to A's landmark, rig intact;
  playhead on B's drop + A's drop cue locked = double-drop alignment.

## Acceptance criteria

- [ ] A-hotcue (unlocked): window+B+playhead translate together; playhead
      ends on the cue; B's audible content at the playhead unchanged
- [ ] A-hotcue (locked): window stays; playhead ends on the cue; the
      B-moment previously at the playhead now aligns with the cue
      (double-drop scenario reproduces by ear and on the grid)
- [ ] A-beatjump ±n: rig shifts n A-beats; playhead keeps its B-position;
      deck B never hiccups, also while playing
- [ ] `startSec ≥ 0` clamp respected with a notice when an A-slide would
      push the window before the sketch origin
- [ ] Slide math extensions under vitest (mirror signs, playhead delta)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

- `11-deck-slides-groundwork-deck-b.md` (slide math module, lock toggle,
  negative-anchor support)

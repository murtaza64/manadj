# 12 — Deck A controls: transport (jump), not slides

Status: ready-for-human (implemented 2026-07-03, change `vryroqtw`, after a
re-grill replaced mirror-A slides with transport semantics; verify the A
jump row and the two-gesture double-drop line-up)

## Parent

`.scratch/mix-editor/PRD.md` (Deck slides — A rows re-decided 2026-07-03).
Glossary: Slide (B-scoped), Sketch origin. Prototype iteration.

## Decision (grill 2026-07-03 #3, supersedes the mirror-A quadrant rows)

Mirror-A slides add no expressive power (PRD equivalences: unlocked-A ≡
locked-B, locked-A ≡ unlocked-B) and cost a per-session re-explanation.
Deck A's controls are plain transport instead: one deck slides (B), one
deck is the axis you navigate (A). Line-ups become two comprehensible
gestures: A drop cue (jump there) → B drop cue unlocked (align drops).

## What to build

- Deck A card row labeled `jump` — same idiom/visuals as B's `slide` row
  (`◄◄ − [n] + ►►` halve/double 1–128, colored hot cue buttons):
  - Hot cue: `player.seek(cueTime)` — identical to a timeline click.
  - Beat jump: `player.seek(playhead ± n·60/bpmA)` — phase-preserving,
    A's own beats.
- No lock interaction: the locked-window toggle scopes to B gestures only.
- Docs: PRD quadrant table A rows replaced with transport semantics;
  glossary `Slide` scoped to the incoming track; `Locked window` B-scoped.

## Acceptance criteria

- [ ] A-hotcue tap lands the playhead exactly on the cue, paused and
      playing (both decks re-cue — plain seek semantics)
- [ ] A-beatjump ±n moves the playhead by exactly n A-beats, preserving
      phase; halve/double 1–128 idiom matches Performance
- [ ] Lock toggle has no effect on A's controls
- [ ] Signature line-up lands: A drop cue → B drop cue (unlocked) aligns
      the drops, by ear and on the grid
- [ ] tsc, eslint on touched files, vitest green; NOTES.md entry; PRD +
      glossary updated

## Blocked by

None — 11 landed.

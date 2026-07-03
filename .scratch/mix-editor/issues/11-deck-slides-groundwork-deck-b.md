# 11 — Deck slides: groundwork + deck B controls

Status: ready-for-human (implemented 2026-07-03, change `roxuvwyx`; awaiting
user verification — cue-slide feel unlocked/locked, negative-anchor gap
playback on a real pair, slides during playback. Known soft spot: waveform
row B's display window goes negative during a lead gap; verify the renderer
draws blank there rather than garbage.)

## Parent

`.scratch/mix-editor/PRD.md` (Deck slides). Glossary: Slide, Locked window,
Sketch origin. Prototype iteration.

## What to build

The slide foundation plus deck B's controls, end-to-end:

- **Model hygiene**: move `bInSec` from `ProtoMix` into `ProtoTransition`
  (B's entry is pair knowledge; must switch with the named Transition).
  Migrate existing localStorage saves.
- **Negative entry anchor first-class**: `bInSec < 0` = silent lead gap
  (B's audio begins partway into the window). Player defers deck B's start
  to the true audio start; timeline draws B's block from it. No B-side
  clamps in either direction (large positive = virtual origin before mix 0,
  fine). `startSec ≥ 0` remains the only clamp.
- **Locked window toggle** in the transition controls (boolean; glossary
  semantics: locked = window rides the slid track).
- **Deck B slide controls** on the deck card:
  - Hot cue buttons (existing hot cue slots): slide B so the cue coincides
    with the playhead — unlocked mutates `bInSec`, locked mutates
    `startSec` (per the PRD table). Playhead does not move; only deck B
    re-cues (also while playing).
  - Beat jump: reuse `playback/beatjump.ts` idiom (`◀ [n] ▶`, halve/double,
    1–128), jumps in B's own beats.
- **Pure slide math module** (extend `mixProtoModel.ts`): gesture × lock →
  `{startSec, bInSec}` mutation, incl. rateB scaling.

## Acceptance criteria

- [ ] Switching between two saved Transitions of the same pair switches B's
      entry point (bInSec rides the artifact); old saves migrate
- [ ] Cue-slide near B's start overshoots into `bInSec < 0` cleanly: block
      draws the gap, playback stays silent until B's true start, no clamp
- [ ] Short-A-into-deep-B: B entry at a late cue works; nothing renders
      before mix 0
- [ ] Standing on A's drop, tapping B's drop cue (unlocked) aligns the drops;
      locked variant relocates window+B instead — both exact, playhead still
- [ ] Slides during playback re-cue deck B only; deck A never hiccups
- [ ] Beatjump controls match the Performance idiom incl. halve/double
- [ ] Slide math under vitest (all four quadrant mutations, rate scaling,
      negative-anchor arithmetic)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately.

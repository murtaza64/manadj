# 05 — Alignment gestures: one marker, shared plumbing, glossary rename

Status: ready-for-agent

## Parent

`.scratch/deck-controls/PRD.md` (alignment class); glossary: Alignment
nudge, Slide, Locked window.

## What to build

The Transition editor's DeckCard gesture controls keep their semantics
(Slides / jump / Alignment nudge) but converge on the shared visual
language plus ONE systematic marker:

- **Alignment accent**: a dedicated accent color on borders/labels of
  every control that realigns the pair (B's slide hot-cues, slide
  beatjump, the Alignment-nudge ◀/▶, lock toggle) — visually separating
  them from the adjacent curation controls (grid ◀ D ▶) which move to the
  shared `GridEditControls` (slice 03). The `editor-pair`/
  `editor-cueslide` dialect dissolves into `player-button` + accent.
- Hot-cue row rewires onto `useHotCueActions` with an injected trigger
  (press = Slide on B / mix-jump on A; set-empty and right-click-delete
  come from the shared hook — the re-implemented copies go).
- Beatjump gesture size reads the per-deck DeckContext size (slice 04) —
  per-card state deleted.
- Rename `editorStore.nudgeTrack` → `alignmentNudge` (code follows the
  glossary).
- Icons (PRD icon language): slide-beatjump uses the jump-arrow icons
  (accent-marked); the Alignment nudge keeps PLAIN ◀/▶ + accent — with
  every other pair carrying a specific icon, that combination is
  unambiguous.

## Acceptance criteria

- [ ] Every pair-realigning control carries the accent; curation controls
      in the same card don't — the two ±10ms pairs are no longer
      confusable
- [ ] Editor hot-cue set/delete behavior identical, now via the shared
      hook; slide/jump press semantics unchanged (issues 11/12 behavior)
- [ ] Gesture size = deck size (change it in PERF, the editor cluster
      shows the same N)
- [ ] `nudgeTrack` gone; store tests updated
- [ ] tsc, eslint, vitest green

## Blocked by

- 04 (shared size + pad plumbing). 03 for the grid-cluster extraction it
  sits beside.

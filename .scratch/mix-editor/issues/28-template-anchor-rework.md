# 28 — Template anchor rework: align-and-window

Status: closed (implemented change ppxknkuk; user-verified 2026-07-05)
Blocked by: nothing (03 landed, change qnxmltss).

## Parent

`.scratch/mix-editor/PRD.md` (Transition templates section — anchor model
reworked 2026-07-04 #2). Glossary: Transition template (rewritten).

## Why

The landed model (issue 03) anchors both sides at the window START, so a
lead-in needs the double-delta trick (shift both deltas by −lead) — exactly
the unintuitive part. Rework: one **alignment rule** ("B's cue 2 lands on
A's cue 4 + delta") plus a **window around the alignment instant** (N beats
before, M after). Same expressive power, coordinates match how the move is
thought; B's anchor ≈ B's mix-in reference.

## What to build

- Model: `alignA.base` + single `deltaBeats` (whole beats, A's grid) +
  `alignB.base` (no delta) + `beforeBeats`/`afterBeats` (free-signed ints,
  `before + after ≥ 0`; zero total = hard cut at the anchor).
- Apply: alignment instant = A-local time of `alignA.base + delta`;
  `startSec` = instant − before·periodA (clamp ≥ 0 + notice);
  `durationSec` = (before+after)·periodA; `bInSec` = B-anchor −
  before·periodB (native). Per-side fallback chains unchanged
  (set cue → relative ladder → absolute grid-origin → anchors untouched,
  all-or-nothing).
- Scalable: proportional — `k = chosenTotal/(before+after)`,
  `before' = round(before·k)`, `after' = chosenTotal − before'`; anchor
  keeps its relative window position.
- Save derivation (order matters): alignment instant = mix position of
  B's base; `delta` = instant − A-base in A-beats, rounded;
  `lengthBeats` = round(duration/periodA); `before` = round((instant −
  startSec)/periodA); `after = lengthBeats − before` (remainder).
  Defaults: B = earliest set cue inside B's window span, else nearest,
  else grid origin; A = set cue nearest the alignment instant. Modal
  shows the derived sentence ("B's cue 2 lines up with A's cue 4 + 8
  beats; window 32 before / 64 after").
- Schema: migration `0014_<jj-id>` swaps columns
  (`align_a_delta_beats`/`align_b_delta_beats`/`length_beats` →
  `align_delta_beats`/`before_beats`/`after_beats`) **with exact
  conversion**: `align_delta = dA − dB`, `before = −dB`,
  `after = length + dB` (B's bare anchor sits −dB beats after the old
  window start; the grill originally recorded the sign-flipped formulas —
  corrected during implementation, verified by the round-trip test).
  Schemas/router/wire/store types follow.

## Acceptance criteria

- [ ] "Line up the drops, blend 32 before, ride 32 after" authors as
      `align(A cue4 + 0 → B cue4)`, window 32/32 — no delta arithmetic
- [ ] Negative `after` (window ends before the anchor) and zero-total
      (hard cut at the anchor) apply correctly
- [ ] Scalable apply at half/double total keeps the anchor's relative
      position (proportional split, integer-exact: before' + after' =
      chosen total)
- [ ] Save modal: two base picks only; derived sentence shown; B default
      = earliest set cue inside B's window span
- [ ] Migration converts existing template rows exactly (round-trips
      the old apply semantics); single alembic head
- [ ] Pure-module tests (vitest): apply math incl. negative/zero
      windows, proportional scaling, save derivation order (after as
      remainder), defaults; router tests updated for new columns
- [ ] Glossary/PRD stay true (already updated by the grill docs change)

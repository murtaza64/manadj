# 07: Mix zone refinements

Status: done (landed mywmmnyy 2026-07-05; lane perfui stays open for further UI iteration)

User-requested refinements to the deck MIX zone (screenshot 2026-07-05):

1. Move the headphone-cue (PFL) button from the foot row into the knob row.
2. Knob row reads as one row: TRIM / LOW / MID / HI / FLT / PFL.
3. Foot row becomes `[LOCK] <key>  <bpm> [MATCH]` — LOCK leads (padlock
   icon), key next, gap, then bpm and MATCH as an `=` glyph (`≠` in red for
   the out-of-reach hint).

Testing Decisions: visual review by the human (lane app); frontend build +
vitest as regression floor. Review-gated — do not land without approval.

## Comments

- Iteration (2026-07-05, in-session review): knobs + PFL spread evenly
  across the row (`space-between`, no clustering); PFL stays at the right
  end on BOTH decks — the mirrored/inside-edge placement was tried and
  scrapped.
- Implementation: lane perfui, change `mywmmnyy`
  (`perf-layout: 07-mix-zone-refinements`) touching DeckPanel.tsx MixZone +
  PerformanceView.css. Verified: frontend build clean, 923/923 vitest.
  Lane app serving on http://localhost:5323 for review.
- Scope grew during review (same change): loop + beatjump rows and the
  nudge pair restyled as joined segmented panels (`.deck-bpm` idiom) in
  deckControls.css / PerformanceView.css; LOOP word replaced with a
  repeat-cycle icon (LoopRow.tsx). BeatjumpRow is shared, so the editor
  player gets the same look.
- Done (2026-07-05): approved in-session; rebased onto trunk (one CSS
  conflict vs sets-15 automation ghosts, resolved), gate green (build,
  968/968 vitest, single alembic head), `main` → `mywmmnyy`.

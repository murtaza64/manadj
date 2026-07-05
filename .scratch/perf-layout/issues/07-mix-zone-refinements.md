# 07: Mix zone refinements

Status: ready-for-human (implementation parked on lane perfui, change mywmmnyy)

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

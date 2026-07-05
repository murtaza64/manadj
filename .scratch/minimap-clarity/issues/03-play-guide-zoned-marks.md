# 03 — Play-guide minimap marks: bar + mid-height play arrow

Status: ready-for-human
Type: task

## Parent

`../PRD.md` (Verdict section) — prototype-validated in issue 01.

## What to build

Port the "Zoned marks" guide treatment to the Performance view's play-guide
minimap overlay (the DOM tick layer above the deck-panel minimaps). Replaces
today's 3px-wide, 38%-height top ticks.

Per guide (from the prototype — the decision):

- **Shape**: 1px full-height vertical bar + ▶ play arrow (right-pointing
  triangle) at MID-height, arrow ~8px tall, growing rightward from the bar.
- **Color**: the incoming deck's color, as today.
- **Next guide** (earliest non-missed): emphasized — 2px bar, larger arrow
  (~11px), full opacity.
- **Other upcoming guides**: 0.7 opacity.
- **Missed guides**: 0.3 opacity (today: 0.35).

The guide model (aTime, missed) is already computed; this is presentation
only. Emphasis must update as guides get missed while the deck plays.

## Acceptance criteria

- [ ] Guides on the deck-panel minimap render as full-height bar +
      mid-height play arrow in the incoming deck's color
- [ ] Exactly one guide (the earliest non-missed) is emphasized; emphasis
      moves to the following guide the moment one is missed
- [ ] Missed guides dim to 0.3
- [ ] Marks don't occlude the hotcue flags (top zone) or main-cue triangle
      (bottom zone) beyond their 1px bar — the arrow occupies mid-height
- [ ] Verified live with a deck pair that has several saved transitions

## Blocked by

None - can start immediately.

## Comments

**2026-07-05 — implemented (lane minimap-clarity, change wmmuzpzl, stacked on 02), parked ready-for-human.**

- `PlayGuideOverlay.css`: `.perf-minimap-guide` is now a 1px full-height
  bar + ▶ CSS-triangle at mid-height (~8px tall) via `::after`, painted
  with `currentColor` (deck color set once per incoming class). `.next`:
  2px bar + ~11px arrow, opacity 1; other upcoming 0.7; `.missed` 0.3.
- `PlayGuideMinimapMarks.tsx`: computes the emphasized guide as the
  earliest non-missed by aTime (no sort-order assumption); emphasis moves
  when a guide flips to missed because `usePlayGuides` keys its signature
  on `missed`. Presentation only — the model is untouched.
- Verified headless with pair 549→171 (two saved transitions): exactly one
  `.next` at a time; seeking the outgoing deck past a guide dims it to 0.3
  and moves the emphasis to the following guide; arrows sit clear of the
  top flag zone and bottom triangle zone.
- Gate: vitest 817, build + tsc + eslint clean.

**Verification walkthrough (lane app at http://localhost:5273):**

1. Performance view, load 549 ("Weeble Wobble VIP") on A and 171
   ("Last Time") on B — the pair has two saved transitions A→B.
2. Deck A minimap: two pink (deck-B color) guide marks — full-height bar
   with a ▶ arrow at mid-height. The earlier one is bolder (2px bar,
   bigger arrow); the later one is thinner at 0.7 opacity.
3. Seek/play deck A past the first guide (~77s in): it fades to 0.3 and
   the second guide becomes the emphasized one — exactly one bold guide
   at any moment.
4. Note the guides' arrows don't cover deck A's hotcue flags (top) or a
   main-cue triangle (bottom) — only their 1px bar crosses those zones.

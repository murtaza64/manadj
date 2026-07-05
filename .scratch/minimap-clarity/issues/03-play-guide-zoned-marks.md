# 03 — Play-guide minimap marks: bar + mid-height play arrow

Status: ready-for-agent
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

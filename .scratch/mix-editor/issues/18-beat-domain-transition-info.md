# 18 — Beat-domain transition readouts (inputs removed)

Status: ready-for-agent (re-specced 2026-07-04 with the user: the original
beats⇄time INPUT toggle is obsolete — graphical manipulation is the main
interaction mode, typed entry explicitly not wanted; readouts should be
beat-domain and useful)

## Parent

`.scratch/mix-editor/PRD.md`. Companion to the beat-domain direction
(templates §, deck slides §); ADR 0010 unaffected — model stays seconds,
beats are a display affordance.

## What to build

Replace the center panel's three number inputs (start / length / B entry)
with display-only beat-domain readouts:

- **start** — musical position on the OUTGOING track's grid: `bar.beat`
  (e.g. `33.1`); seconds as secondary/hover detail.
- **length** — beats (bars called out for multiples of 4): `32 beats`.
- **B entry** — the INCOMING track's grid position where it enters (its
  own grid — correct with tempo match off); when negative, read as the
  lead-gap size in B beats.
- Fractional to one decimal when a value sits off-grid (off-grid is by
  design, e.g. un-snapped drags).
- Per-value fallback: a gridless track's fields show time with a subtle
  marker.
- No inputs, no toggle, no persistence pref. Manipulation is drag/trim/
  slide on the timeline (plus deck-card gestures); the old
  `setTransitionField` number-input path is deleted.

## Acceptance criteria

- [ ] The three inputs are gone; readouts show bar.beat / beats / B-entry
      beats live during drags (they're in the drag-rate subscriber panel
      already — mix-editor 27)
- [ ] Whole-beat positions read clean (no `.0` noise); off-grid values
      show one decimal
- [ ] B entry uses B's grid; negative entry reads as lead gap in B beats
- [ ] Gridless per-value time fallback with indicator
- [ ] Conversion helpers pure + under vitest (both grids, bar.beat math
      incl. grids that don't start at t=0, fractional, negative entry)
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None. Center panel is shared with the templates UI (mix-editor 03, landed
2026-07-04) — coordinate layout, don't crowd the switcher row.

# 18 — Beat-domain transition readouts (inputs removed)

Status: ready-for-human (implemented, change lmnqxqkq — verify by eye:
readouts read musically during drags; note the format decision: off-grid
positions show as ~nearest bar.beat rather than fractional beats — the
timeline shows exact, readouts orient)

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

- [x] The three inputs are gone (`setTransitionField` survives only for
      the tempo-match checkbox); readouts live in the drag-rate panel
- [ ] Readouts read usefully during drags — BY EYE
- [x] Whole-beat positions read clean; off-grid = `~nearest` bar.beat
      (format refinement over the spec's one-decimal: `1.1.5` was
      unreadable — lengths still show one decimal, e.g. `3.5 beats`)
- [x] B entry uses B's grid; negative entry reads `gap N beats`
- [x] Gridless per-value fallback: dimmed seconds + tooltip marker
- [x] Conversion helpers pure + vitested (12: offset grids, variable
      grids, extrapolation, bar inference, fractional, negative entry)
- [x] tsc, eslint, vitest 279, build green

## Blocked by

None. Center panel is shared with the templates UI (mix-editor 03, landed
2026-07-04) — coordinate layout, don't crowd the switcher row.

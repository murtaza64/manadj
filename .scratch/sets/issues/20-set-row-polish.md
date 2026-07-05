# 20 — Set view row polish (batch of human review feedback)

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (feedback batch 2026-07-05, from live use of the Set view)

## What to build

Six small changes to the Set detail rows, all from the same review pass:

1. **Explicit edit button on adjacency rows** — the click-through to the Transition editor (issue 09) exists, but there is no visible affordance saying so; add a small "edit" button beside the pin chip (same verb split as practice: *edit* = sketch it, *practice* = mix it live).
2. **Cyan→magenta gradient on transition-row left bars** — adjacency rows sit between a cyan-deck track and a magenta-deck track (or vice versa); their left accent bar should be a vertical gradient between the two adjacent rows' deck colors (direction follows the actual deck parity), visually tying the handover to its tracks.
3. **Insert affordance becomes a small `+` on the LEFT side** of the adjacency row (currently a labeled button on the right); tooltip carries the old label.
4. **Fix the space use / alignment**: adjacency-row content is indented into dead space (see screenshot in review notes) — left-align the adjacency row's chips with the track-row titles so both columns start at the same x.
5. **Drop the dashed border on the practice button** — restyle as a plain quiet button consistent with the other row affordances.
6. **Merge the UNRESOLVED chip into the hard-cut chip** — no separate "UNRESOLVED — will hard-cut" chip; an unresolved adjacency's "✕ hard cut" chip itself turns red to carry the meaning. (A *pinned Transition named* "hard cut" keeps the normal green transition chip — the red styling keys off pin state, not the name.)

## Acceptance criteria

- [ ] Adjacency rows: [+] on the left, pin chip + edit + practice grouped left-aligned with track titles, no dashed borders anywhere
- [ ] Unresolved adjacencies show a single red hard-cut chip; resolved ones never do; UNPRACTICED badge unchanged
- [ ] Transition-row left bars render the two-deck gradient with correct per-parity direction
- [ ] Edit button opens the Transition editor exactly like the row click-through (09)
- [ ] No behavioral changes — styling and affordance placement only (plus the one new button delegating to existing behavior)

## Notes

- `sets/SetDetailPane.tsx` rows are contested while issue 07 (dormant pins / drag preview) is in flight on lane setui — dispatch after 07 parks/lands, or coordinate.

## Blocked by

- Soft: 07-reorder-preview-dormant-pins in flight (same rows)

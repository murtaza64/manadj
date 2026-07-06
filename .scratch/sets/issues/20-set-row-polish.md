# 20 — Set view row polish (batch of human review feedback)

Status: done

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

## Comments

**2026-07-06 — implemented (lane setui, change `tvvvnmok`, styling the
final row DOM on top of 23+18); parked ready-for-human.** All six items;
`frontend/src/sets/SetDetailPane.tsx` only.

1. `✎ edit` button beside the pin chip — delegates to the same
   `onOpenEditor` as the row click-through (09); no new behavior.
2. Deck-gradient left bars: `linear-gradient(180deg, outgoing, incoming)`
   from the PLAN's decks (parity-true, preview-consistent since 23's
   `displayPlan` feeds both rows and bar), painted as a 3px background
   layer so the hover wash composes. `DECK_COLORS` is the source.
3. Insert affordance is a small borderless blue `+` in the left gutter;
   the old label rides the tooltip.
4. Alignment: adjacency chips start at x=81 exactly like track titles
   (15px padding + 58px gutter + 8px gap ≡ 3+12+18+12+24+12); the `+`
   sits under the play-button column; gutter renders even with no
   insert affordance, so alignment never jumps.
5. No dashed borders anywhere in the rows: practice/auto-fill/
   will-restore all went solid; practice is a plain quiet button
   (surface0/surface1, yellow text).
6. UNRESOLVED badge deleted; the "✕ hard cut" chip itself turns red
   (red bg, bold) — keyed off `adjacencyView` pin STATE, so a pinned
   Transition named "hard cut" keeps its green chip. UNPRACTICED
   unchanged.

- Verification: frontend build clean; vitest 1048; pytest 666;
  `alembic heads` single; eslint clean on the touched file (one
  pre-existing warning). Two-axis review: no violations; minor
  judgement-call smells noted (quiet-button style repetition —
  pre-existing file pattern).

**Verification walkthrough** (lane app on ports 8140/5313):
open http://localhost:5313 → the demo Set →
1. Look at any adjacency row: left `+`, then pin chip · ✎ edit ·
   ⏵ practice starting exactly at the track-title x; no dashed borders.
2. The adjacency row's left bar is a vertical cyan↔magenta gradient
   matching the deck stripes of the rows above/below it (direction
   flips with parity — compare two consecutive adjacency rows).
3. Unpin an adjacency (chip → Unpin): the chip itself turns red
   "✕ hard cut" — no separate UNRESOLVED badge anywhere. Re-pin: green
   (or mauve take) chip returns. A Transition literally named "hard
   cut", if pinned, stays green.
4. Click ✎ edit: the Transition editor opens exactly like clicking the
   row body. Esc/return; click ⏵ practice: decks cue as before (plain
   quiet button now).
5. Hover the `+`: tooltip reads the old "Suggest a track to insert
   here…" label; click it: the insert-suggestions popover opens as
   before.

**2026-07-06 — approved and landed** (`tvvvnmok`, re-gated after the stack rebased onto trunk with 19's row badge: vitest 1063, pytest 666, frontend build clean, single alembic head `0022_mwzqllkt`).

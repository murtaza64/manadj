# 36 — Trailing suggest row replaces the header Suggest button

Status: ready-for-human

## Parent

.scratch/sets/PRD.md

## What to build

Unify the suggestion affordances (sets 10) around gaps. Today the terminal gap
(after the last track) is served by a header **Suggest** button while every
between-track gap gets an inline `+ insert` affordance — the same operation,
two interaction patterns. Replace the header button with a **trailing ghost
row** at the end of the Set list:

- Styled in the `+ insert` affordance family, but **permanently visible**
  (not hover-only) — it is the primary set-building affordance.
- Clicking it opens the existing append suggestion popover
  (`SetSuggestions`, `target.kind === 'append'`) anchored at the row.
- Empty Set: the row stays visible with the existing hint copy
  ("Add a track first — suggestions rank out of the last track"), disabled.
- Remove the header Suggest button. No ranking/model changes —
  `follow/suggest.ts` untouched.
- Drag-append already works pane-wide; no new drop-target work required
  (fine if the row naturally participates).

## Acceptance criteria

- [ ] Trailing row visible at the end of every Set list, `+ insert`-family styling, no hover required
- [ ] Click opens the append suggestion popover; accepting appends with the usual auto-fill pin offer
- [ ] Empty Set shows the disabled row with the add-a-track hint
- [ ] Header Suggest button gone
- [ ] Per-adjacency `+ insert` behavior unchanged

## Blocked by

- Sequencing, not a hard dependency: touches `SetDetailPane.tsx` rows area
  claimed by lane setui's running batch (31/32/35/33). Dispatch after that
  batch parks/lands, or into the same lane afterwards.

## Comments

**2026-07-06 — filed (orchestrator).** Design settled in-session with the
human: append is an insert at the terminal gap, so it gets the same gap
affordance as every other gap. Decisions recorded above (permanent
visibility, empty-set hint, button removal).

**2026-07-06 — implemented (lane setrows, change `ttpsnrqv`, stacked on
26's `lmmppypt`); ready-for-human.** Trailing `+ suggest a track` row
(`.set-suggest-row`, `.set-glyph-btn`/adjacency-row family: blue +,
hover fill, always visible) after the last row inside the scroll pane;
click opens the existing append popover anchored at the click; empty set
renders it disabled with the hint copy inline. Header Suggest button
removed — transport and Auto-fill untouched (issue 39 deferred, header
left as is). `follow/suggest.ts` and `SetSuggestions` unchanged. Gate:
build ✓, vitest 1174 ✓.

**Verification walkthrough** (lane app running: http://localhost:5363):

1. Open any Set with tracks: the header's right side now shows only
   Auto-fill; at the very bottom of the track list sits a permanently
   visible blue `+ suggest a track` row.
2. Click it → the familiar append suggestion popover opens at the row;
   accept a candidate → it appends, and the new adjacency gets the usual
   treatment (auto chip or red cut per 26).
3. Per-adjacency `+` (left gutter of every handover row) still opens
   insert suggestions, unchanged.
4. Create a new empty Set: the row reads "Add a track first —
   suggestions rank out of the last track", disabled (no popover on
   click).

# 36 — Trailing suggest row replaces the header Suggest button

Status: ready-for-agent

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

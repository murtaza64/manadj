# 09 — Dedicated marks column

Status: done — pending user eye-verify

## Parent

.scratch/follow-mode/PRD.md (eye-verify follow-up: inline marks indent only marked rows — ragged title edges, layout shift as decks change)

## What to build

Move the ◆/★/🔗 row marks out of the title cell into a dedicated column immediately left of Title, in every track table (library, playlist, split panes, embedded Performance browse).

- Two fixed slots, one per Deck, in Deck colors. Each slot shows that Deck's strongest evidence — ★ (favorited Transition) > 🔗 (Linked) > ◆ (saved Transition) — the Known ranking the tier headers already use. Empty slots keep their width.
- Tooltip enumerates the full evidence for the row ("Saved transition from deck A's track (favorite) · Linked with deck B's track").
- Blank header; not sortable; fixed width outside the column-resize system; always present even when both Decks are empty (no-layout-shift principle).
- Title cell renders just the title again (the flex title-line wrapper from the alignment fix goes away with the inline marks).
- Tier section headers span the widened table.

## Acceptance criteria

- [ ] Marks render in the new column, Deck-colored, best-evidence-per-Deck, tooltips carry the rest
- [ ] Title left edge is uniform across marked/unmarked rows; no table shift when Loads change marks
- [ ] Column present and empty-stable in all track tables incl. playlist and embedded browse
- [ ] Section headers (follow-mode 08) span correctly
- [ ] Gate green

## Blocked by

None - can start immediately

## Comments

- Done (sostyvrl, lane marks): `marks` column added to columnConfig (34px, sticky, between energy and title — sticky offsets and table width auto-derive); blank non-sortable header without a resize handle; TrackRow renders two fixed slots via `markSlot` (★ > 🔗 > ◆ per Deck) with `markEvidence` tooltip enumerating everything; colSpans 11/12; title cell back to plain text (the 08 flex-title-line workaround removed — obsolete now); ★-scale rule retargeted to the slot. Gate: 539 pytest / 607 vitest / build / one head.

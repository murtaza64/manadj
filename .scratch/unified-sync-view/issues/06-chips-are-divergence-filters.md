# Chips are Divergence filters, not section toggles

Status: ready-for-agent

## Parent

User-reported (2026-07-04): clicking the "main cue diverged" chip only reveals the collapsed maincue *section* — tracks whose maincue divergence rides along in higher-priority sections are invisible, and the chip's count undercounts. Grilled 2026-07-04; glossary gained **Sync inbox** and **Divergence filter** (CONTEXT.md).

## What to build

Split the two reads of the unified sync chip bar per the glossary:

- **Chip off (Sync inbox, default)**: unchanged — priority sections, each row exactly once.
- **Chip on (Divergence filter)**: sections disappear; one flat list of every row matching the chip's predicate, titled like "34 tracks — main cue diverged". Rows keep their normal card (expand, matrix, per-cell imports, visual diff).
- **Predicates** (single active chip, toggle): status chips keep their status predicates (missing-downstream / unimported / not-in-library); divergence chips match any row whose diverged fields intersect the chip's bundle — tags|energy, title|artist, beatgrid|hotcues, bpm|key, maincue.
- **Counts**: chip numbers always show the predicate count (true affected-track totals), in both modes. Section headers keep showing inbox (section) counts — the two may legitimately differ.
- Group actions that make sense for a predicate (e.g. bulk performance-data import on the beatgrid/hotcues and maincue chips) appear above the flat list, scoped to the filtered rows.

## Acceptance criteria

- [ ] Activating the maincue chip lists every row with a maincue divergence, including rows the inbox files under higher-priority sections
- [ ] Chip counts equal the predicate counts in both modes; section counts unchanged
- [ ] Status chips (missing-downstream, unimported, not-in-library) behave as before, restyled into the same flat-view pattern when active
- [ ] Exactly one chip active at a time; toggling off returns to the inbox
- [ ] Bulk perf-data import action available above the flat list for the two perf chips, scoped to filtered rows
- [ ] Row cards in the flat view keep full functionality (expand, imports, visual diff)
- [ ] Frontend build + vitest pass; visual check by the user

## Blocked by

None - can start immediately

## Comments

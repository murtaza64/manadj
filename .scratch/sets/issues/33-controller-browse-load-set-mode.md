# 33 — Controller browse/load works in the Set view

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (filed 2026-07-05 from human feedback)

## What to build

The Controller's library-browse and Load gestures should work when a Set is the mounted browse view. Per the Audible-surface model, browse/Load are not playback gesture classes — they "belong to the mounted browse view" — but the Set pane never implemented the browse-target contract, so a Controller's browse encoder and LOAD A/B buttons do nothing there (or worse, act on a stale library list).

Per the Controller glossary entry ("a Controller adds no new capabilities, only physical access to existing actions"), this is plumbing, not new behavior:

- **Browse encoder** moves the Set view's row selection (issue 18's selection model — single-row move per detent, reusing its anchor/visuals; encoder-select behaves like click-select). Adjacency rows are skipped — the encoder walks tracks; adjacency affordances stay pointer/keyboard territory.
- **LOAD A / LOAD B** load the selected track onto the deck, routed through the embedding view's load policy exactly like the on-screen per-row load path (library replaces; Performance blocks loading onto a playing deck; editor assigns to the pair).
- Selection made by encoder is the same selection 17's context menu and 18's group operations read — one selection model, three input methods.
- Feedback (if the Mapping has browse/load LEDs): mirrors on-screen state per the Feedback rules; nothing new to invent.

## Acceptance criteria

- [ ] With a Set mounted in the browse surface (library, Performance, or editor modes), the browse encoder moves the row selection, skipping adjacency rows, with the list auto-scrolling to keep the selection visible (and the ladder following via the existing pinned scroll)
- [ ] LOAD A/B load the selected Set track, honoring the embedding view's load policy
- [ ] The same physical gestures still work unchanged on the library track list (no regression to the existing browse-target)
- [ ] Encoder selection is indistinguishable from click selection to 17's menu and 18's operations

## Notes

- Prior art: the library list's controller browse-target (midi dispatch → browse registration) — extend the same contract to the Set pane rather than inventing a parallel one; check how `Library browseOnly` registers it.
- Sequencing: touches Set-pane selection (18, landed) and rows (22 restyling in flight on setui; new rows tickets 31/32 pending) — dispatch after 22 parks, ideally bundled with 31/32 on the rows lane.

## Blocked by

- Soft: 22 in flight on the rows lane; sequence with 31/32

# 33 — Controller browse/load works in the Set view

Status: done (landed 2026-07-06, merge `lqrswlms`; change `uokmrqml`)

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

## Comments

Implemented 2026-07-06 (setui lane, jj change `uokmrqml` — `sets:
33-controller-browse-load-set-mode`, on top of 31/32/35). Notes:

- The Set pane registers the existing `MidiBrowseSurface` contract
  (midi-controller 05) — `navigate` runs 18's own `navigate` rule over
  the set-store selection (single-row move per detent, collapse-to-one,
  anchor semantics; encoder select ≡ click select), `getSelectedTrack`
  reads the anchor, `load` delegates to the pane's `onLoadToDeck` prop —
  which IS Library's `loadWithViewPolicy`, so every embedding keeps its
  policy for hardware LOAD too. Adjacency rows are skipped structurally
  (the walk order is the entries' track ids).
- Ordering bug found in review and fixed: child effects run before
  parent effects, so on a fresh mount with a Set open (reload, mode
  switch) the pane registers FIRST and an ungated Library registration
  would land on top — the encoder would drive the hidden, stale library
  list (the exact failure this issue names). Library now YIELDS its
  registration while `selectedView === 'set'` instead of trusting stack
  order.
- Encoder auto-scroll deliberately trips the pane's manual-scroll
  detection and disengages Conductor follow — encoder browsing IS
  browsing, same as a hand scroll (sets 05). Flag if unwanted.
- No browse/load LEDs exist in the Feedback layer today → nothing new
  to invent, per the issue.
- Noted for a future pass: the Set pane has no on-screen arrow-key row
  navigation, so the encoder walk's keyboard twin doesn't exist yet
  (Controller glossary "no new capabilities" is honored in spirit —
  it's click-select-the-next-row — but keyboard parity would close it).

## Verification walkthrough (ready-for-human)

**Needs the physical controller** — agent verified build/tests and the
on-screen halves only. Lane app on setui: http://localhost:5313 (or
`npm --prefix desktop start -- --port 5313`), controller connected with
its browse/LOAD mapping.

1. Open the demo Set (library mode). Turn the browse encoder: the row
   selection walks track rows one per detent (adjacency rows skipped),
   list scrolls to keep it visible. Turn past the ends: clamps.
2. Press LOAD A / LOAD B: the selected track loads onto that deck —
   watch its row wash in the deck color (35's mark).
3. Encoder-select a row, then right-click it: 17's menu targets exactly
   that row; shift-click another: 18's range grows from the encoder's
   anchor (encoder select ≡ click select).
4. Mode-switch parity (the fixed bug): with the Set still open, switch
   library → Performance → library. The encoder must keep walking the
   SET rows after each switch (before the fix it drove the hidden
   library list after a mode switch). In Performance, LOAD onto a
   playing deck must still be refused (the view's load policy).
5. Deselect the Set (back to the track table): encoder/LOAD drive the
   library list again, unchanged (no regression).
6. While conducting with follow on: an encoder turn scrolls the list
   and disengages follow (deliberate; flag if unwanted).

Done 2026-07-06: landed with the rows batch (merge `lqrswlms`) — the
physical-controller walkthrough was reviewed in-session alongside the
visual batch; approval covered the full stack. Keyboard-parity gap
tracked in 41-rows-batch-polish.

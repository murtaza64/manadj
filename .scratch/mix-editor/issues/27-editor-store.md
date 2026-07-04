# 27 — Editor store: session state behind a snapshot/subscribe seam

Status: ready-for-agent (grilled 2026-07-04; behavior-frozen refactor —
architecture review candidate #2, urgency raised by the 2026-07-04
data-loss incident in issue 26's comments)

## Parent

`.scratch/mix-editor/PRD.md`. Architecture review 2026-07-04 (#2).
Evidence: two perf passes named the whole-tree 60/s re-render escalation;
the seed/flush/debounce race that deleted saved Transitions lives in
effect-ordering the store makes unrepresentable.

## What to build

`frontend/src/editor/editorStore.ts` — class instance (DeckEngine house
style), created by the shell, provided via context:

- **Snapshot**: immutable `{ mix, session, pairKey, snap, lockedWindow }`;
  `subscribe`; `useEditorSelector(sel)` hook on `useSyncExternalStore`
  with `Object.is` equality — widgets subscribe narrowly (a DeckCard on
  `session.active` doesn't render during a 60/s lane drag).
- **Mutations**: named where semantics exist — `slideDeckB`, `nudgeTrack`,
  `navigateTransition`, `renameActive`, `toggleFavorite`, `deleteActive`,
  `loadPair`, `setSnap`, `setLockedWindow` — plus a generic
  `updateMix(fn)` escape hatch for the drag paths (behavior-frozen; the
  drag protocol narrows with issue 16, the first feature subscriber).
- **Persistence moves in**: store-internal 300ms debounce; saves are armed
  INSIDE mutations (only a loaded session can schedule one — the
  incident's race becomes unrepresentable; the `loadedPairKey` guard is
  deleted, not ported). `loadPair` flushes the previous pair before
  seeding; `dispose()` flushes the tail. Seam-injected
  `{ load, save }` defaulting to pairStore's snapshot/savePairEntry.
- **Stays outside** (component glue reading the store): MixPlayer (a
  subscriber — kills the "push to player NOW" special case, store notify
  is synchronous), arbiter claim, trackA/B + deck adoption/mirroring,
  frameSignal/park choreography, keyboard handling.
- pairStore's materialization rules stay in pairStore; the store calls
  them.

## Acceptance criteria

- [ ] Behavior-frozen: editor is indistinguishable by eye (drag feel,
      autosave, switcher, favorites, marks, pair adoption, park/framing)
- [ ] Store-interface tests (fake persistence + fake timers, no DOM/audio):
      unseeded-pair switch never materializes a delete (the incident);
      flush-before-repoint; pristine-only session saves nothing; pristine
      evaporation on navigate; mutation coalescing; dispose flush; active
      clamping; hole-reused names; favorite toggle
- [ ] Shell passes the deletion test: layout + glue only (no slide/trim/
      persistence logic left in TransitionEditor)
- [ ] DawTimeline/DeckCard/TransitionSwitcher consume the store (props
      bundle shrinks; drag paths may keep `updateMix` for now)
- [ ] No new perf regression at drag rate (rAF dirty-key tick still
      absorbs redundant notifies; `?protoperf` spot-check)
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None. Issue 16 (node group selection) should land AFTER, as the first
narrow subscriber.

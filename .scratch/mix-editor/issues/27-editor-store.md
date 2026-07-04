# 27 — Editor store: session state behind a snapshot/subscribe seam

Status: closed (implemented change rrkluqks; user-verified 2026-07-04)

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

- [x] Behavior-frozen: editor is indistinguishable by eye (drag feel,
      autosave, switcher, favorites, marks, pair adoption, park/framing)
      — BY EYE
- [x] Store-interface tests (14, fake persistence + fake timers): the
      incident (unseeded-pair switch materializes nothing), flush-before-
      repoint, pristine-only saves nothing, pristine evaporation, mutation
      coalescing, dispose flush, active clamping, rename/favorite,
      onTransitionLoaded events, view toggles never arm saves
- [x] Shell passes the deletion test: session/persistence/slide/lane logic
      all moved; shell is tracks/decks/player glue + layout. The
      post-incident `loadedPairKey` guard is DELETED (structurally
      unnecessary — saves arm inside mutations only)
- [x] DawTimeline consumes the store via narrow selectors (7 props →
      1); center panel extracted as the drag-rate subscriber; shell no
      longer subscribes to `mix` (drag re-renders: whole tree → timeline
      + small panel). Drag paths keep `updateMix` (narrows with 16)
- [x] No new perf regression at drag rate — `?protoperf` BY EYE
- [x] tsc, eslint, vitest 211, build green

## Blocked by

None. Issue 16 (node group selection) should land AFTER, as the first
narrow subscriber.

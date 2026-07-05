# 03 — LOAD via the browse surface

Status: ready-for-human

## Parent

`.scratch/editor-midi/PRD.md`

## What to build

Fix the LOAD mismatch: load policy is view-owned, so LOAD leaves the
deck-controls registry and joins the browse-surface registration (ADR 0019's
"deliberately not surface-routed" half):

- The browse-surface registration gains a load handler supplied by the
  embedding view: editor → assign-to-pair (mirrors to the shared decks,
  re-seeds the saved Transition, no lock — same as double-click there);
  Performance → the existing lock with silent refusal; library view → free
  replace.
- Hardware LOAD A/B dispatches to the registered browse surface's load with
  the selected Track; no browse surface → drop.

## Acceptance criteria

- [ ] Editor: hardware LOAD assigns the selection to the pair slot and the
      editor UI shows it (no more invisible shared-deck load)
- [ ] Performance: LOAD refused on a running deck, silently
- [ ] Library view: LOAD replaces freely
- [ ] Sync/styles views: LOAD and encoder are silent no-ops
- [ ] Dispatch tests cover per-view policy fakes and the no-surface drop
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

## Comments

- 2026-07-05 (edmidi lane): implemented in jj change `mqpotnws`. `load`
  left MidiDeckControls (and the registrar's lock-always handler) and
  joined MidiBrowseSurface: dispatch hands the selected Track to the
  registered browse surface's `load(deck, track)`; no surface or no
  selection drops. Library registers the view's policy — `onLoadToDeck`
  when embedded (editor `assignTrack` = assign-to-pair + mirror + re-seed;
  Performance `tryLoad` = lock with silent refusal) else the library's free
  replace onto the shared Decks; the row context menu routes through the
  same function (`loadWithViewPolicy`). Dispatch tests cover policy fakes,
  no-surface and no-selection drops. Status → ready-for-human: HARDWARE
  SMOKE TEST — editor: LOAD A/B assigns the selection to the pair and the
  editor UI shows it (saved Transitions re-seed); Performance: LOAD refused
  silently on a running deck, loads on a stopped one; library view: LOAD
  replaces freely even while playing; sync/styles views: encoder + LOAD do
  nothing.

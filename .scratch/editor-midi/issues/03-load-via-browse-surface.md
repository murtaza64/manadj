# 03 — LOAD via the browse surface

Status: ready-for-agent

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

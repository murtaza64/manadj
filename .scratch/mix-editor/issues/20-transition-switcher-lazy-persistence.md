# 20 — Transition switcher: navigation, rename, favorite, delete, lazy persistence

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md` (Library discovery & transition management).
Glossary: Favorite, Preferred pair.

## What to build

Replace the saved-Transition dropdown with the switcher, and make
persistence lazy:

- `◀ [name] ▶` + position hint (`2/3`), creation-ordered; `▶` past the
  last = new button → pristine "Transition n" (next free number).
- Inline rename (click name, Enter commits, Esc reverts); favorite star
  toggle beside the name.
- **Lazy persistence**: pristine Transitions (auto-created on load, or via
  new) exist only in memory; first real edit (lane point, anchor change,
  rename, favorite) materializes them to storage. Navigating away from a
  pristine one discards it silently.
- **Delete replaces the reset button**: inline two-step confirm (no
  modal). Last Transition of the pair → re-init a blank one (same feel as
  the old reset); otherwise navigate to the next in the list.
- Migration: existing localStorage saves keep working; pristine-shaped
  legacy entries (never edited beyond defaults) may be pruned on first
  load.

## Acceptance criteria

- [ ] Dropdown gone; navigation, position hint, end-of-list new all work
- [ ] Rename and favorite persist and materialize pristine Transitions;
      navigating away from an untouched new Transition leaves no storage
      trace
- [ ] Delete: two-step confirm; last-one deletion re-inits blank; otherwise
      lands on the next Transition; reset button removed
- [ ] Opening and abandoning many pairs creates zero stored Transitions
- [ ] Materialization rules pure + under vitest (what counts as a real
      edit)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None - can start immediately.

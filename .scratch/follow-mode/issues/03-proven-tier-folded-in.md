# 03 — Proven tier folded in

Status: ready-for-agent

## Parent

.scratch/follow-mode/PRD.md

## What to build

Fold the proven evidence tier into Follow. Tracks with a saved Transition from a followed reference (transition index, from-direction) are always in the candidate set — OR'd in even when the heuristic parameters would exclude them, so a favorited tempo-jump move still surfaces. A "proven only" parameter narrows the set to just that tier (the old transitions chip's job). The existing ◆/★ row marks continue to distinguish proven candidates from heuristic ones.

Retire the standalone transitions filter entirely: the filter axis in shared filter state, its FilterBar chip, and the modal checkbox. Its story was always this story.

## Acceptance criteria

- [ ] A Track with a saved Transition from a followed reference appears in the followed list even when outside the heuristic parameters (e.g. beyond the BPM threshold)
- [ ] "Proven only" narrows the list to the proven tier of the followed references
- [ ] Dual follow: proven tiers of both references union
- [ ] The `hasTransitionFromDecks` axis, FilterBar chip, and modal checkbox are gone
- [ ] Proven rows carry the existing ◆/★ marks
- [ ] Model tests: proven-OR membership against a constructed transition index; proven-only narrowing; dual-follow union
- [ ] Gate green

## Blocked by

- 01-follow-core-manual-toggles

## Comments

- Done (qtylowow, lane followmode): `candidateIdSet` in the follow model — heuristic union ∪ proven tier (keys of the transition index's from-direction map per followed reference), `provenOnly` narrows to just the proven tier; 5 tests incl. one against a constructed index (real Map shape + pristine-pair exclusion). Retired everywhere: `hasTransitionFromDecks` axis (FilterContext), the ◆ transitions chip (FilterBar), the modal checkbox, both client-side filter blocks, and the quick-apply preservation rule. ◆/★ row marks unchanged. Known interim gap, per plan: `provenOnly` has no UI control until the parameters modal rework (issue 05) — it rides the stored settings key (default false). Gate: 530 pytest / 520 vitest / build / one head.

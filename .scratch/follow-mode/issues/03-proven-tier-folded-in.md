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

# 15 — Small fixes (running ticket)

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md` (general editor polish). Running collector for
minor Transition-editor fixes — append new items as they're reported; each
item is independently shippable.

## Items

- [ ] **Lane labels get text-selected**: clicking/dragging around the
      automation lane editors sometimes highlights/selects the lane label
      text (and possibly other editor chrome). Suppress selection on editor
      UI (`user-select: none` on labels/controls; keep any genuinely
      selectable text like track titles selectable deliberately).

## Acceptance criteria

- [ ] Each checked item verified by the reporting scenario (e.g. rapid
      click/drag in lanes never highlights labels)
- [ ] tsc, eslint on touched files, vitest green
- [ ] NOTES.md mention only if an item turns out non-trivial

## Blocked by

None - can start immediately.

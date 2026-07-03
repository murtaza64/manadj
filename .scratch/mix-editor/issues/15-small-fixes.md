# 15 — Small fixes (running ticket)

Status: ready-for-agent

## Parent

`.scratch/mix-editor/PRD.md` (general editor polish). Running collector for
minor Transition-editor fixes — append new items as they're reported; each
item is independently shippable.

## Items

- [x] **Lane labels get text-selected** (2026-07-03): `user-select: none`
      on `.mixproto-top`; inputs, track titles, and artist lines opt back
      in with `user-select: text`.

## Acceptance criteria

- [ ] Each checked item verified by the reporting scenario (e.g. rapid
      click/drag in lanes never highlights labels)
- [ ] tsc, eslint on touched files, vitest green
- [ ] NOTES.md mention only if an item turns out non-trivial

## Blocked by

None - can start immediately.

# 12 — Lifecycle edges

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Graceful degradation at the Set's boundaries with the rest of the library: deleting a pinned Transition or Take turns the pin Unresolved (active or Dormant — never a broken reference); Archiving a Track that belongs to a Set flags the Set (visible in sidebar + detail) rather than silently altering it. Planner treats missing artifacts as hard cuts.

## Acceptance criteria

- [ ] Deleting a pinned Transition/Take degrades the pin to Unresolved; playback hard-cuts there
- [ ] Dormant pins referencing deleted artifacts are dropped
- [ ] A Set containing an Archived Track shows a flag; playback still works (Archived audio remains on disk)
- [ ] Router/planner tests cover all three degradations

## Blocked by

- 02-adjacency-pins-evidence

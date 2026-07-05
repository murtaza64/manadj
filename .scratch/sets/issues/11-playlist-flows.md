# 11 — Playlist flows

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

The two Playlist↔Set conveniences, both one-time copies (no live link): **New Set from Playlist** — copy the Playlist's Play order into a new Set, offering auto-fill for every adjacency with library Transitions; **Create Playlist from Set** — copy the Set's track order into a new ordinary Playlist (the escape hatch to Export; Sets themselves never Export).

## Acceptance criteria

- [ ] Set created from a Playlist preserves order; auto-fill offer covers eligible adjacencies
- [ ] Playlist created from a Set preserves order and Exports like any Playlist
- [ ] Neither direction creates a live link — later edits on either side don't propagate

## Blocked by

- 01-set-model-sidebar-crud

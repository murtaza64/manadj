# 09 — Adjacency click-through to the Transition editor

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Clicking an adjacency in the Set view loads the pair onto the Decks (outgoing→A, incoming→B — the editor always presents outgoing-as-A regardless of Conductor parity) and switches the top panel to the Transition editor: a Transition pin opens with that Transition selected; a Take pin opens the existing Take-review flow; unresolved opens a blank sketch for the pair (the rehearsal to-do click-through). The browse surface below does not remount or move — the Set view is still there under the editor, so walking a set's handovers (tune adjacency 3, click adjacency 4) stays inside editor mode. Clicking while the Conductor plays stops it (mode switch; editor entry pauses shared playback via the audible-surface arbiter).

## Acceptance criteria

- [ ] Transition pin → editor on that pair with the pinned Transition selected
- [ ] Take pin → Take review for that Take
- [ ] Unresolved → blank sketch for the pair
- [ ] Set pane below the editor keeps its scroll/selection; clicking another adjacency swaps the editor pair without leaving the mode
- [ ] Edits to a pinned Transition reflect in the Set plan on return (no stale plan)

## Blocked by

- 02-adjacency-pins-evidence

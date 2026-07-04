# 03 — Curation cluster: grid nudge + set downbeat, one component

Status: ready-for-agent

## Parent

`.scratch/deck-controls/PRD.md` (curation class).

## What to build

One `GridEditControls` component (◀ D ▶, ±10ms, downbeat-at-playhead)
used by the tag editor, PERF `BeatgridBlock`, and editor DeckCard:

- Playhead source injected (DeckEngine playhead vs MixPlayer track time).
- Styling: `player-button` idiom with a density modifier; the tag
  editor's inline style overrides and the editor's `editor-pair` copy go
  away for this cluster.
- Keyboard (library Shift+H/L, G) calls the same handlers.
- The ±10ms constant gets one home (today: `GRID_NUDGE_MS` in DeckPanel +
  literals elsewhere).

## Acceptance criteria

- [ ] Three call sites, one component; behavior identical by eye in each
- [ ] Anchor rides nudges (slice 01 semantics — verify via API state)
- [ ] Gridless/not-ready disabled states preserved per mode (library's
      `isBeatgridEditable` gate)
- [ ] tsc, eslint, vitest green

## Blocked by

- 01 lands first (anchor semantics); can start UI extraction in parallel.

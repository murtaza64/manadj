# 03 — Curation cluster: grid nudge + set downbeat, one component

Status: ready-for-human — implemented in change `rqwskknq` (deck-controls: 03-curation-cluster)

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
- Icons (PRD icon language): grid nudge uses the grid-ticks-with-arrow
  SVG pair (not plain ◀/▶); set-downbeat uses the ANCHOR icon (⚓ drawn —
  the button sets `anchor_time`, ADR 0016: icon = concept), replacing
  "D". `components/icons/` already exists (slice 04 landed it).

## Acceptance criteria

- [ ] Three call sites, one component; behavior identical by eye in each
- [ ] Anchor rides nudges (slice 01 semantics — verify via API state)
- [ ] Gridless/not-ready disabled states preserved per mode (library's
      `isBeatgridEditable` gate)
- [ ] tsc, eslint, vitest green

## Blocked by

- 01 lands first (anchor semantics); can start UI extraction in parallel.

## Comments

Done (change `rqwskknq`): `GridEditControls` (components/deckControls/) now
renders the ◀ anchor ▶ cluster in all three modes; `GRID_NUDGE_MS` lives in
hooks/useBeatgridData.ts (DeckPanel copy + TagEditor/DeckCard/keyboard
literals deleted); new icons GridIcons.tsx (grid-ticks-with-arrow pair) and
AnchorIcon.tsx (anchor replaces "D"); styling via `.deck-gridrow` (+`.mini`)
in deckControls.css — TagEditor inline styles and the editor's grid
`editor-pair` + "downbeat @ playhead" button removed. Library Shift+H/L and
G unchanged (same Library handlers → same mutations). tsc/eslint/vitest
(334)/build/pytest (504)/alembic single head all green.

By-eye checklist for a human:
- [ ] Library tag editor: grid cluster next to the beatgrid icon — nudge
      icons + blue anchor; disabled with "Load this track…" tooltip until
      the edited track is loaded and ready; Shift+H/L and G still work.
- [ ] PERF BeatgridBlock GRID row: same cluster at mini density, disabled
      until deck ready.
- [ ] Editor DeckCard: grid cluster (mini) sits where the grid pair +
      "downbeat @ playhead" button were; track-nudge pair untouched.
- [ ] Anchor rides nudges: set downbeat, nudge, GET /beatgrid shows
      anchor_time shifted by ±0.01s (slice 01 semantics).

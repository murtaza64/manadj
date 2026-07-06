# 32 — Lane UI/UX pass: toggles, deck-family colors, control idiom, polarity

Status: ready-for-agent (grilled 2026-07-05; all items settled)

## Parent

`.scratch/mix-editor/PRD.md` (editor polish). Ten user gripes grilled 2026-07-05. Glossary updated same session: Slide (arrow polarity convention), Deck color (lane hue families).

## Items

1. **Lane toggles replace the add-lane dropdown.** Per-deck toggle strip at the left edge of each deck's lane region: five chips per deck — `FADER LOW MID HIGH FILTER` — colored per lane color, engaged = inverted fill. On = `addLane` (unhide, envelope restored), off = `hideLane` (envelope kept) — today's semantics exactly (per-Transition, persisted, audible: hidden lanes play their default). The `add lane…` `<select>` (`TransitionEditor.tsx:970-985`) and the per-strip `×` (`DawTimeline.tsx:907-913`) both die.
2. **Lane colors move into deck hue families** (`laneColors.ts` stays the single source). Uniform role→hue-offset, both decks, full saturation:

   | Role | Offset | A (anchor 187°) | B (anchor 330°) |
   |---|---|---|---|
   | LOW | −40° | `#00ff6e` | `#b52dff` |
   | FILTER | −22° | `#00ffc3` | `#f22dff` |
   | FADER | 0° | `#00e5ff` | `#ff2d95` |
   | MID | +22° | `#008cff` | `#ff2d4e` |
   | HIGH | +42° | `#2d50ff` | `#ff5c2d` |

   Fader = pure deck color. Chips, strip edges, labels, envelopes all pull from this table.
3. **Hot cue marks adopt the global zoned-mark idiom** (hotcue-colors/01): editor waveform rows swap issue 14's triangles for pole + small square flag (flag at the row's outer edge — A top, B bottom), **numbered badge kept**; editor GlobalMinimap triangles → 5×5 square flags (match the performance minimap); every `#39ff14` cue fallback (lane guides `DawTimeline.tsx:848,892`, minimap `GlobalMinimap.tsx`) → slot palette `HOT_CUE_CSS_COLORS`, stored-color-wins.
4. **Tempo match + snap become button toggles** (replacing the native checkboxes, `TransitionEditor.tsx:954-969`): player-button style, labels `TEMPO` / `SNAP`, engaged = inverted `var(--green)` fill (the app-wide active-state color — top-bar quantize toggle is the model). Templates-trigger open state (`transitionEditor.css:954-960`) also sapphire → `var(--green)`; sapphire retires from editor engaged-states. Blur after click (kills two keyboard-focus thieves). Semantics unchanged (tempoMatch = persisted model state; snap = view state).
5. **Lane strip gradient removed**: flat `#0e0e16`, keep the 3px deck-colored inset edge (`transitionEditor.css:299-307`). In-window overlays unchanged.
6. **Lane labels de-verbosed**: display names `FADER LOW MID HIGH FILTER` via one display-name map beside `LANE_COLORS`; used by strip labels and toggle chips. Raw `LaneId`s survive only in model/persistence.
7. **Lock defaults on**: `lockedWindow` initial `true` (`editorStore.ts:68`); stays unpersisted session-view state. (Named tension, accepted: the signature double-drop flow now starts with a lock-off press.)
8. **B slide polarity flips to apparent motion** (glossary Slide entry updated): ▶ moves B's drawn block right — unlocked `bInSec −= δ`, locked `startSec += δ/rateB` — so the arrow always matches on-screen motion in both lock modes. Scope: DeckCard ◀/▶ (`DeckCard.tsx:179,203`), MIDI beatjump ports (`TransitionEditor.tsx:393-401`), alignment nudges. **Jog B exempt** (platter metaphor: forward = music advances — current polarity already correct). Hot-cue slides unaffected (absolute). Tooltips reworded.
9. **Outer padding stripped**: `.editor-arranger` `padding: 6px 12px` → 0 (`transitionEditor.css:73`), matching the other modes' edge-to-edge look.
10. **Vertical overflow fixed**: the editor column must always fit its viewport — replace the fixed `max(280px, 34vh)` timeline + `overflow-y: auto` arranger math with a flex height budget summing to 100%; no scrollbar in any mode at sane window sizes.

## Acceptance criteria

- [ ] Every lane addable/removable in one click from the per-deck strips; envelope survives an off/on round-trip; dropdown and × gone
- [ ] All ten lane colors per the table; A lanes read as a cyan family, B as magenta; chips/labels/edges/envelopes agree
- [ ] Editor cue marks: pole + square flag + numbered badge in rows; square flags in the minimap; no `#39ff14` fallback anywhere in the editor
- [ ] TEMPO/SNAP toggle buttons in green, no checkboxes; templates trigger green when open; neither steals keyboard focus after click
- [ ] Lane strips flat; deck edge intact
- [ ] Lock on at every editor mount; toggling still unpersisted
- [ ] B ▶ beatjump moves B's block visibly right in both lock modes; MIDI beatjump matches; jog unchanged; tooltips match the new polarity
- [ ] Editor fills its panel edge-to-edge with zero vertical scroll
- [ ] Pure logic (polarity signs, visible-lane set math) under vitest; tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

None. Coordinate: same LaneCanvas/DawTimeline surface as 16 (ready-for-human, change rlrspylz) and 30 (ready-for-agent) — rebase over whichever lands first.

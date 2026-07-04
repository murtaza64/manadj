# 17 — Site design language: selects and numeric inputs

Status: ready-for-human (implemented 2026-07-03, change `knyunyzv`; visual
check wanted. Also swept dead CSS: .mixproto-play, -picker*, -body,
-deckrow, -controls*, -lanes/-lane old-layout blocks.)

## Parent

`.scratch/mix-editor/PRD.md`. Completes the design-language pass from
NOTES.md v8 ("deck-card / load buttons / selects still to bring in line").

## What to build

Style the editor's `<select>` dropdowns (saved-Transition picker,
add-lane) and numeric inputs (start/length/entry, BPM, pitch, beatjump
amount) to the site's control style — the `player-button` idiom:
transparent background, 1px functional-color border, bold, square corners,
catppuccin vars. References: `frontend/src/components/Player.css`,
`frontend/src/components/prototype/performance-prototype.css`.

- Native select/input chrome suppressed (appearance: none) with a custom
  caret for selects; focus state consistent with existing buttons.
- Number inputs: spinner buttons hidden or restyled; keyboard/wheel entry
  unchanged.
- Sweep the editor for stragglers from the v8 pass (load→A/B, deck-card
  grid buttons) and remove the unused `.mixproto-play` CSS block noted in
  NOTES.md.

## Acceptance criteria

- [ ] All editor selects/numeric inputs visually consistent with
      player-button controls (border, weight, squareness, colors) in
      idle/hover/focus/disabled states
- [ ] No remaining default-chrome controls in the editor top panel
- [ ] Unused `.mixproto-play` CSS removed
- [ ] eslint on touched files green; NOTES.md iteration entry

## Blocked by

None - can start immediately. CSS-only; safe alongside any other issue.

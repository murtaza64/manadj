# 09 — Top-bar titles + icon mode switch; deck nudge buttons; shift = fine drag

Status: done (2026-07-03, user-verified)

## Parent

`.scratch/mix-editor/PRD.md`. User-requested iteration 2026-07-03.

## What to build

1. Top bar: mode switch becomes icons; the active section's title shows in
   the bar (every section gets one, not just the editor). The editor's own
   title bar (h1 + help text) is removed entirely.
2. Deck nudge buttons on both editor deck cards: fine (±10ms) horizontal
   movement of that track relative to the other. Nudging B moves B's block
   and the transition frame together (same semantics as dragging the B
   block); nudging A moves A relative to B, implemented as the inverse
   (frame + B shift the other way — A itself anchors the mix axis).
3. Shift-drag = fine drag: holding shift during any timeline drag ignores
   beat snap.

## Acceptance criteria

- [ ] Icon switch + section title in the top bar; editor header/help gone
- [ ] Nudge buttons move alignment by ±10ms with the frame following B
- [ ] Shift-drag bypasses snap for B move and both trims
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

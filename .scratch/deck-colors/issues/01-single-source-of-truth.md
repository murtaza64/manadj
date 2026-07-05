# 01 — Deck colors: single source of truth

Status: done — pending user eye-verify

## What to build

One canonical home for the Deck colors (CONTEXT.md: Deck color — A cyan `#00e5ff`, B magenta `#ff2d95`, identity only). Today the pair is hardcoded verbatim in three places (the editor's lane-color constants, the editor stylesheet, the track-row marks stylesheet).

- A theme module exports the pair for canvas/TS consumers (the editor's canvas code can't read CSS variables without getComputedStyle).
- App boot injects `--deck-a` / `--deck-b` plus `--deck-a-rgb` / `--deck-b-rgb` (space-separated triplets, for `rgba(var(--deck-b-rgb), 0.14)` alpha washes) onto the document root from that module — the TS module is the single source.
- Migrate the three existing sites to consume it: the lane-color constants rebuild `faderA`/`faderB` on the base pair (the per-lane EQ/filter variants remain that module's own palette); the editor stylesheet's labels, block frames, lane strips, window edges, deck cards, and minimap wash use the vars; the ◆/★ track-row marks use the vars.

## Acceptance criteria

- [ ] Zero visual change anywhere (pure refactor)
- [ ] `#00e5ff` / `#ff2d95` (any case, hex or rgb triplet) greps to exactly one module in the repo
- [ ] Gate green (pytest, vitest, frontend build, single alembic head)

## Blocked by

None - can start immediately

## Comments

- Done (wsvtupok, lane followmode): `theme/deckColors.ts` (DECK_COLORS + hexToRgbTriplet + installDeckColorVars, 2 tests); boot injection in main.tsx; migrated laneColors fader pair, all transitionEditor.css sites (incl. rgba washes via --deck-*-rgb), TrackRow.css marks + loaded-row underlines, GlobalMinimap canvas (B wash + playhead, the latter documented as A's color since mix time ≡ the outgoing Track's time). Deliberate exception: PerfDiffViewer's dev-only LIBRARY_COLOR keeps its own cyan — it means "library", not Deck A.

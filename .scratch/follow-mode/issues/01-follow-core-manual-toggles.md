# 01 — Follow core: manual toggles drive the list live

Status: done — pending user eye-verify

## Parent

.scratch/follow-mode/PRD.md

## What to build

The tracer bullet: a per-Deck Follow toggle in the FilterBar that, while on, keeps the browse list filtered to Tracks Compatible with that Deck's loaded Track — updating live when the Track changes (Load replaces it), in both the library view and the Performance view's embedded browse.

Introduce the pure `follow` model module (the feature's single seam). This slice ships its derivation face: reference Track + parameters → per-reference query params (harmonic keys, BPM center + threshold, energy range, tag IDs with any-shared/ANY semantics), reusing the existing harmonic-keys and energy-range utilities. Flag state in this slice is manual-only (toggle on/off per Deck); the playback auto-rules come in issue 02.

Follow is a composed predicate: it never writes the shared filter state. Final list = manual filters ∩ (union of followed Decks' candidate sets). One track-list query per followed reference (existing list API), unioned and deduped client-side. Manual controls stay fully usable and narrow the followed set; turning Follow off restores the manual view exactly. A Deck's toggle is disabled while it has no Track loaded.

Parameters are read from the existing stored find-compatible settings for now (modal rework is issue 05).

## Acceptance criteria

- [ ] FilterBar shows per-Deck A/B Follow toggles, disabled for an empty Deck
- [ ] Toggling Follow on a Deck narrows the list to its Compatible candidates without touching any manual filter control
- [ ] Loading a different Track onto a followed Deck updates the list with no further interaction
- [ ] Both Decks followed = per-track union of the two candidate sets (full conjunction per reference, no per-axis merging), deduped
- [ ] Manual filters (search, tags, energy, BPM, key) intersect with the followed set; toggling Follow off restores the prior browse view unchanged
- [ ] Works in the library view and the Performance view's embedded browse
- [ ] Framework-free model tests: derivation per parameter combination (each axis on/off, energy presets, any-shared tag set); union/dedupe
- [ ] Gate green (pytest, vitest, frontend build, single alembic head)

## Blocked by

None - can start immediately

## Comments

- Done (llpkorpk, lane followmode): pure follow model at `frontend/src/follow/` — derivation face (`deriveFollowQuery`, `getHarmonicKeys`, `getEnergyRange`) + `unionIds`, 12 framework-free tests; module-level `followStore` (routingStore idiom, manual flags only); FilterBar per-Deck ⟲A/⟲B toggles (enable requires a loaded Track; an on-flag is always turn-off-able); Library composes manual ∩ union-of-candidates via one query per followed reference (partial-ready union: a loading second reference never un-narrows the list). Stored one-shot settings are explicitly projected onto FollowParams (ALL tag mode + refDeck deliberately dropped). Known limits accepted for this slice: placeholderData shows the previous reference's candidates during a Load's fetch window; candidate sets cap at the library query's 1000-row parity. Gate: 530 pytest / 481 vitest / build / one alembic head.

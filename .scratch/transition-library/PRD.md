# PRD: Transition library — discovery, favorites, and transition management

Status: ready-for-agent
Feature: transition-library (extracted 2026-07-03 from the mix-editor PRD's "Library discovery & transition management" + "Discovery unification" sections; grills #4–#5)

## Problem Statement

As a DJ, my saved Transitions are invisible outside the editor: standing in the library or mid-performance, I can't see which tracks I've already built transitions for, which of those are proven moves, or which candidate tracks would even mix with what's playing. Managing multiple Transitions per pair is clumsy (a dropdown, no rename, no way to mark the good one, a reset button instead of delete), and the existing "Find Related" feature is disconnected from transition knowledge — it predicts compatibility but never tells me what I've already proven.

## Solution

Make saved Transitions a queryable **Transition library** (glossary) surfaced where decisions happen: library rows get per-deck marks for tracks with saved transitions *from* either loaded deck (alternating-deck workflow), starred when the pair is **Preferred** (has a **Favorite** Transition). The transition switcher replaces the dropdown with navigable, renamable, favoritable, deletable Transitions backed by lazy persistence (only edited Transitions ever hit storage — merely-opened pairs leave no trace). The renamed **Find Compatible** feature becomes a loaded-deck action and gains a proven-tier switch, unifying discovery's two evidence tiers — *heuristics propose, Transitions confirm* — on one surface.

## User Stories

1. As a DJ, I want a favorite flag on a Transition, so that I can mark proven moves distinct from sketches.
2. As a DJ, I want a pair to support multiple favorites or none, so that the flag reflects reality per-Transition rather than per-pair.
3. As a DJ, I want library rows marked when a saved Transition exists from the track loaded in deck A, so that I can see my prepared continuations while browsing.
4. As a DJ, I want the same marks for deck B's track, so that the alternating-deck workflow (next track loads into the free deck) is served for both decks.
5. As a DJ, I want the two marks visually distinct by source deck (deck accent colors), so that I know which loaded track each continuation belongs to.
6. As a DJ, I want the mark starred when the pair has a favorited Transition, so that proven pairings stand out from mere sketches.
7. As a DJ, I want a "has transition from loaded decks" filter in the library filter bar, so that I can browse only my prepared continuations.
8. As a DJ, I want merely-opened pairs to never appear as saved transitions, so that abandoned editor visits don't pollute discovery.
9. As a DJ, I want ◀/▶ navigation through a pair's Transitions with a position hint, so that switching between takes is one click instead of a dropdown.
10. As a DJ, I want a "new" button when I navigate past the last Transition, so that starting another take has zero ceremony.
11. As a DJ, I want to rename a Transition inline, so that takes get meaningful names ("bass swap", "long wash").
12. As a DJ, I want to delete a Transition with an inline confirm, so that dead-end edits don't accumulate.
13. As a DJ, I want deleting the last Transition of a pair to re-init a blank one, so that the editor never strands me (same feel as the old reset).
14. As a DJ, I want deleting a non-last Transition to land me on the next one, so that cleanup flows without re-selection.
15. As a DJ, I want never-edited Transitions (including fresh "new" ones) to evaporate when I navigate away, so that discarding a false start requires no action at all.
16. As a DJ, I want "Find Compatible" (né "Find Related") to run from a loaded deck chosen via A/B buttons in the modal, so that I match against what's actually playing instead of hunting for its row.
17. As a DJ, I want a "has transition" switch inside the Find Compatible modal, synced with the filter-bar toggle, so that one dialog configures both discovery tiers.
18. As a DJ, I want applying compatible criteria to preserve the transition filter (and Clear All to clear both), so that composing "compatible AND proven" is predictable.
19. As a DJ, I want the quick-apply arrow to reuse my last settings and deck choice, so that repeat discovery is one click.
20. As a DJ, I want marks and stars to update live on load/unload/save/favorite/delete, so that the library never shows stale knowledge.
21. As the developer, I want the index, materialization rules, mark derivation, and filter composition as tested pure modules, so that discovery correctness is regression-guarded.

## Implementation Decisions

- **Domain model** (glossary: Favorite, Preferred pair, Transition library, Compatible): `favorite: boolean` lives on the Transition artifact only. Preferred pair is always derived (≥1 favorited Transition for the ordered pair), never stored. Bookmarking unsketched pairings is explicitly a different (worklist) concept — do not widen Favorite.
- **Lazy persistence / materialization**: auto-created and new Transitions exist in memory; the first real edit (lane point, anchor change, rename, favorite) materializes them to storage. Untouched ones evaporate on navigate-away/pair-switch/exit. Legacy pristine-shaped saves may be pruned on load. This is both the discovery-index honesty mechanism and the first discard tier.
- **Switcher**: replaces the dropdown. Creation-ordered; `◀ [name] ▶` + position hint; past-the-end = new ("Transition n", next free number); inline rename (Enter/Esc); star toggle; delete replaces the reset button with two-step inline confirm (no modals) — last-one deletion re-inits blank, otherwise navigate to next.
- **Index**: direction-aware API (`transitionsFrom(trackId)` / `transitionsInto(trackId)`); v1 marks are outgoing-only from either loaded deck. Prototype-scale implementation: in-memory scan over localStorage, rebuilt on editor save/delete/favorite events.
- **Marks**: one glyph per source deck in the deck's accent color; starred variant for Preferred pairs; no counts in v1. Marks render on any filtered list.
- **Find Compatible** (renamed from Find Related; glossary forbade "related"): loaded-deck reference model — A/B buttons in the modal, selection-based derivation retired, disabled with nothing loaded. Modal gains the proven-tier switch bound to the same filter state as the filter-bar toggle (one source of truth, two controls). Applying writes only the four heuristic criteria (keys/BPM/tags/energy); the transition axis survives; Clear All clears both.
- **Two-tier frame**: heuristic (Compatible) vs proven (Transition library, Favorite-ranked). The frame is the design invariant; a union preset ("proven ∨ compatible candidates") is future work.
- Persistence remains localStorage until the DB-persistence graduation slice; these features raise its urgency (and it unblocks templates) without blocking on it.

## Testing Decisions

- Established seam (ADR 0002 pattern: vitest, pure modules, no DOM/Web Audio mocking) — one seam, existing style:
  - Materialization rules: what counts as a real edit; pristine evaporation.
  - Index correctness: direction (A→B saved must not mark B→A), per-deck sources, live-rebuild triggers as pure reducers.
  - Preferred-pair derivation (multiple/zero favorites per pair).
  - Filter composition: compatible-apply preserves the transition axis; Clear All semantics; modal/filter-bar switch state convergence.
- Switcher interaction flow and mark visuals stay eye-verified in the prototype (screenshot iterations), per the prototype skill.

## Out of Scope

- Sequenced Mixes; auto set-building over the Transition library
- Worklist/bookmarking of unsketched pairings (named non-goal guarding Favorite's meaning)
- Union discovery preset ("proven ∨ compatible")
- Mark counts (×3) and incoming-direction (`transitionsInto`) UI — API supports, UI defers
- DB persistence (separate graduation slice; this PRD works on localStorage)
- Key-authority consolidation of the hand-rolled harmonic expansion (`.scratch/key-authority/issues/01-single-key-authority.md`)
- ML/scored similarity (README future idea)

## Further Notes

- Issues 01–03 of this feature were originally filed as mix-editor issues 20–22 and moved here verbatim (renumbered) when this PRD was extracted.
- Glossary entries (CONTEXT.md): Favorite, Preferred pair, Transition library, Compatible. ADR not needed: decisions are reversible at prototype stage and fully recorded here.
- The mix-editor PRD retains a pointer section; deck slide/UI work continues under that feature.

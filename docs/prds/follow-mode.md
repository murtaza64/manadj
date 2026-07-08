# PRD: Follow mode

Status: ready-for-agent

## Problem Statement

Finding the next track during a set has friction. "Find Compatible" is a one-shot action: it must be re-invoked every time a Deck's Track changes, it clobbers whatever manual filters were set (which don't come back when done), and the proven tier lives in a separate transitions chip that must be toggled independently. Mid-set, the DJ is operating dialogs instead of listening.

## Solution

Follow mode: a per-Deck toggle that keeps the browse list continuously filtered to candidate next Tracks for that Deck's loaded Track, hands-off. Follow rides playback — it spreads to a Deck when it starts playing, retreats when a Deck pauses (unless it was the only Deck playing), and never enables itself from nothing. Candidates carry both evidence tiers: heuristic Compatible Tracks unioned with the proven tier (saved Transitions from the followed Track), tier-ordered by candidate strength. The matching parameters keep their modal, but changes take effect live — there is no Apply. Manual filters are untouched and compose with the followed set. The one-shot "Find Compatible" action and the standalone transitions chip are retired.

## User Stories

1. As a DJ, I want to toggle Follow on Deck A and/or Deck B, so that the browse list continuously shows candidate next Tracks for what I'm playing.
2. As a DJ, I want the list to update automatically when a followed Deck's Track changes (Load replaces it), so that I never re-invoke a dialog mid-set.
3. As a DJ, I want starting playback on a Deck to spread Follow to it when any Deck is already following, so that the incoming Track becomes a reference without me touching anything.
4. As a DJ, I want a Deck that pauses to stop following when another Deck is still playing, so that candidates for the outgoing Track leave the list the moment it's out of the mix.
5. As a DJ, I want the sole playing Deck to keep following when I pause it, so that the candidate list survives mid-set silence instead of exploding back to the whole library.
6. As a DJ, I want a paused-but-following Deck to lose Follow the moment any Deck starts playing, so that a finished Track's candidates don't pollute the list once the set moves on.
7. As a DJ, I want playback to never enable Follow when no Deck is following, so that browsing normally is never hijacked by a mode I didn't ask for.
8. As a DJ, I want the candidate sets of two followed Decks unioned per-track (Compatible with A or with B — full conjunction per reference, not merged filter axes), so that mid-transition I see real candidates for either Track and no chimeras that match neither.
9. As a DJ, I want Tracks with a saved Transition from a followed Track always included in the list, even when the heuristics would exclude them, so that proven moves (e.g. a favorited tempo-jump) always surface.
10. As a DJ, I want proven candidates visibly marked (existing ◆/★ row marks), so that I can tell confirmed moves from heuristic proposals.
11. As a DJ, I want a "proven only" parameter that narrows the list to just the proven tier, so that I can browse only confirmed moves (the old transitions chip's job).
12. As a DJ, I want to edit the matching parameters (harmonic keys, BPM threshold, energy preset, tag matching, proven-only) in a modal whose changes apply live, so that tuning the match never requires re-applying anything.
13. As a DJ, I want tag matching to mean "shares at least one Tag with the reference", so that tag agreement widens sensibly instead of demanding an all-tags match that is nearly always empty.
14. As a DJ, I want my manual filters (search, tag chips, energy, BPM, key) left untouched by Follow and composed with it by intersection, so that I can search within the candidates and get my exact browse view back when Follow turns off.
15. As a DJ, I want a Follow indicator in the FilterBar with per-Deck toggles and a compact summary of what's being derived, so that I can see at a glance why the list shows what it shows.
16. As a DJ, I want clicking the indicator's summary to open the parameters modal, so that the door to tuning is where the state is displayed.
17. As a DJ, I want the Follow toggle disabled for a Deck with no Track loaded, so that I can't enable a follow that contributes nothing.
18. As a DJ, I want the followed list tier-ordered — proven, same Key, relative Key, one Key up, one Key down, then everything else that passed the filter — so that the strongest candidates are at the top.
19. As a DJ, I want a Track that qualifies under both followed Decks ranked by its best tier, so that dual-follow ranking stays coherent.
20. As a DJ, I want my chosen table sort to order Tracks within each tier, so that the tiering never silently discards the ordering I rely on.
21. As a DJ, I want Follow flags and parameters to survive a reload, so that a crash mid-set restores my candidate list along with my loaded Decks.
22. As a DJ, I want Follow available wherever the browse list is — the library view and the Performance view's embedded browse — so that the mode follows the Decks, not a view.
23. As a DJ, I want the old one-shot "Find Compatible" button, its quick-apply, and the standalone transitions chip gone, so that there is exactly one surface for this relation.

## Implementation Decisions

- **One new seam: a pure `follow` model module** with three faces, all framework-free:
  1. **Flag reducer** — `(flags, event) → flags`; events are manual toggle, deck-play, deck-pause, each carrying per-Deck playing/loaded context. Encodes: spread-on-play, drop-on-pause-unless-sole-playing, sticky-expiry (a paused Deck may only follow while nothing plays; any play event revokes paused followers), never-self-enable. Mirrors the existing transport reducer pattern.
  2. **Derivation** — reference Track + parameters → per-reference query params, reusing the existing harmonic-keys and energy-range utilities. Tag matching derives the reference's Tag IDs with ANY semantics (the existing backend mode); ALL mode is dropped from the feature.
  3. **Ranking** — `(track, references, transitionIndex) → tier` plus a comparator composing tier with the user's sort; union/dedupe of per-reference result sets lives here. Tier order (provisional, expected to change): proven, same Key, relative Key, one Key up, one Key down, catch-all. Best tier wins across references.
- **Follow is a composed predicate — it never writes `FilterState`.** Final list = manual filters ∩ (candidates of followed Decks). Manual controls are never locked, clobbered, or restored; an over-narrow manual filter yielding an empty list is accepted behavior.
- **Per-track OR via client-side union**: one track-list query per followed reference (existing list API, existing server-side filtering), results unioned and deduped client-side. No backend changes; no OR-of-conjunctions support server-side.
- **Proven tier** comes from the existing transition index, from-direction of each followed reference; it ORs into the candidate set (and is the whole set under "proven only"). The `hasTransitionFromDecks` filter axis, its FilterBar chip, and its modal checkbox are removed.
- **Reference** = the loaded Track of a followed Deck. Play/pause and track-change detection subscribe to the existing deck snapshot store; no new event bus.
- **Modal rework**: the Find Compatible modal becomes "Follow parameters" — harmonic keys (bool), BPM (bool + threshold %), energy (bool + up/down/near/equal preset), tags (bool, any-shared), proven only (bool). No Apply button; edits are live. The reference-deck picker is removed (per-Deck toggles replaced it). The one-shot action, its quick-apply button, and their FilterBar button group are removed.
- **FilterBar indicator**: per-Deck A/B Follow toggles plus a compact derived summary; clicking the summary opens the modal; a Deck's toggle is disabled while it has no Track loaded. No toggle on the Performance Deck panels; no MIDI mapping.
- **Persistence**: two localStorage keys per the codebase's artifact-vs-preference doctrine — Follow flags as session state (alongside the loaded-decks key), parameters as a preference (replacing the old find-compatible settings key). Restoring flags on boot is invariant-consistent (nothing plays after boot). Nothing server-side.
- Glossary updated: **Follow mode** entry in CONTEXT.md; **Compatible** sharpened (tag agreement = any shared Tag; one-shot ancestors retired).

## Testing Decisions

- Per ADR 0002: tests exercise module interfaces with real internals, fakes only at true seams; test external behavior, never implementation details.
- **The `follow` model module is the tested surface**:
  - Reducer: event sequences → expected flags, covering the full state machine — enable/disable, spread-on-play, drop-on-pause with the sole-playing exception, sticky expiry on any play, never-self-enable from all-off, toggling on an empty Deck rejected.
  - Derivation: reference + parameter combinations → expected query params (each axis on/off, energy presets, tag ANY set).
  - Ranking: tier assignment per reference (including proven via a constructed transition index), best-tier-wins under dual follow, catch-all tier membership, comparator stability with the user's sort within tiers, union/dedupe.
- **Prior art**: the transport reducer tests, track-sort comparator tests, and transition-index tests (framework-free); the transition-store tests for faking localStorage at the seam if persistence helpers are tested.
- The wiring — context/hook glue from deck snapshots to reducer events, the paired queries, FilterBar indicator, modal — is deliberately untested, consistent with the codebase's treatment of hooks and components.

## Out of Scope

- Section headers in the track table reifying the tiers (future idea; tiering ships as ordering only).
- Tag-category-scoped matching ("match tags in: Genre, Vibe") — the known escape hatch if any-shared proves too loose.
- A general server-side settings store (trigger: Desktop shell / browser localStorage divergence actually hurting; separate issue if wanted).
- MIDI/Controller access to the Follow toggles, and toggles on Performance Deck panels.
- Backend OR-of-conjunctions query support.
- Ranking refinements beyond the provisional tiers (e.g. Favorite-weighted ordering within the proven tier).
- Any Mix/setlist planning built on top of Follow.

## Further Notes

- Precedent: Engine DJ's standalone-controller "match" browsing; this design differs by being per-Deck, playback-riding, and two-tiered (heuristics ∪ proven).
- The dual-follow window is brief (a transition's overlap), so two in-flight list queries are acceptable; revisit only if it measurably isn't.
- The tier list is explicitly provisional — the reducer/ranking seam isolates changes to it.
- Opportunistic refactor rider (not a requirement): a tiny typed localStorage preference helper could replace the hand-rolled load/validate/save code the Follow work touches anyway.

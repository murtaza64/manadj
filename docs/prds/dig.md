# PRD: Dig — set brainstorming from evidence

Status: ready-for-agent

## Problem Statement

Set planning today starts long before the Set editor can help. The actual workflow: throw a pile of new tracks into a giant Playlist, mess around on the Decks until pairs start sounding good, gradually place tracks next to each other, and only late — when the order has materialized — does the Set editor's strength apply. The early, brainstorming half of the workflow has no support at all: the evidence it generates (Takes pile up for pairs that get mixed repeatedly; great three-track runs happen live and are forgotten by morning) is captured but never surfaced back. Meanwhile the app *demands* explicit acts (Link, promote, pin) for anything to count in discovery, which is exactly the friction brainstorming can't afford. And the historical record is stranded: most existing sets predate the Set feature and live as Playlists, so nothing can tell "fresh material" from "already used."

## Solution

Make the evidence layer do the brainstorming work, hands-off. Three pieces:

1. **Observed** — a new middle discovery tier: an ordered pair mixed repeatedly (multiple Takes, nothing curated) counts as behavioral evidence, ranked between Known and Compatible everywhere discovery orders candidates. Accrues from normal playing; no gesture required.
2. **The Dig view** — discovery's dedicated surface: a shelf-based browse over the **Unplaced** scope (in the Library, not Archived, in no Set) surfacing **Played runs** mined from the Transition history, **Observed pairs** awaiting a decision, **Chain candidates** (paths over Known+Observed edges never played end-to-end), untried Compatible edges, and a **Wildcard** randomness slot. Shelves, not an inbox; filter chips are session state; no pool artifact exists. The same engine feeds an ambient rail in the Performance view.
3. **Seeding gestures** — a Played run seeds a Set in that order with the run's Takes pinned (the per-run form of the deliberate Take-pinning act), and Seed Set from Playlist (already existing) graduates playlist-era sets so Unplaced reflects history.

All terms are already in the glossary (captured 2026-07-08): Observed, Unplaced, Dig view, Played run, Chain candidate, Wildcard, Seed Set from Playlist, plus the amended Take-pinning doctrine on Set/Take and the three-tier rewrites of Known/Compatible/Follow mode.

## User Stories

1. As a DJ, I want a pair I've mixed several times to rank above metadata-matched candidates in the followed list, so that my actual behavior counts without me filing paperwork.
2. As a DJ, I want a single sloppy accidental blend to count for nothing, so that Observed reflects habits, not noise (multiple-Take floor).
3. As a DJ, I want a pair to leave Observed the moment I Link it or save a Transition for it, so that tiers stay disjoint and meaningful.
4. As a DJ, I want the Observed stratum pinned below Known and above the heuristic stratum in Follow mode, immune to column sorts, so that evidence order is trustworthy.
5. As a DJ, I want "known only" to keep meaning explicitly-curated only, so that narrowing to confirmed evidence still excludes inference.
6. As a DJ, I want a Dig view I can open when planning a set, so that brainstorming has a home that isn't a giant throwaway Playlist.
7. As a DJ, I want the Dig view scoped to Unplaced tracks by default, so that I'm digging through material that hasn't found a home yet.
8. As a DJ, I want placing a track in any Set to graduate it out of the Unplaced scope automatically, so that the pile drains itself as sets form.
9. As a DJ, I want Playlist membership to NOT graduate a track, so that curation playlists don't hide brainstorm material.
10. As a DJ, I want a track I imported months ago and never used to stay in scope (buried by ranking, not expelled by age), so that neglect never deletes candidacy.
11. As a DJ, I want to convert a Playlist into a Set with one gesture (order preserved, adjacencies Unresolved), so that my playlist-era sets count as history and my current playlist-first muscle memory has a bridge.
12. As a DJ, I want a shelf of Played runs mined from my Transition history ("you played A→B→C on Tuesday"), so that accidentally awesome runs are rediscoverable instead of forgotten.
13. As a DJ, I want to seed a Set from a Played run with its Takes pinned, so that the seeded Set plays back the night that inspired it rather than hard-cutting.
14. As a DJ, I want runs I've already acted on (seeded, or fully represented in an existing Set) to stop occupying the shelf, so that the shelf shows discoveries, not chores I've done.
15. As a DJ, I want a shelf of Observed pairs with their Take counts and recency, offering the next step (Link it, review a Take in the Transition editor, pin into a Set), so that ripe pairs get promoted with one click when I'm ready.
16. As a DJ, I want a shelf of Chain candidates — paths where every adjacency has Known or Observed evidence but the full sequence was never played — so that the app proposes set skeletons I didn't notice I'd already proven pairwise.
17. As a DJ, I want a shelf of untried edges — Compatible pairs among Unplaced tracks with zero Takes — so that I have an audition backlog when nothing else inspires.
18. As a DJ, I want a Wildcard slot that alternates between a neglected Unplaced track and an untried pair, with a reroll control, so that serendipity is built in without polluting ranked lists.
19. As a DJ, I want the Wildcard to respect my active filter chips, so that spice stays within tonight's vibe.
20. As a DJ, I want filter chips (key, tag, text) on the Dig view that reset when I leave, so that narrowing is cheap and tunnel vision has no persistence to live in.
21. As a DJ, I want the same pair to be allowed on multiple shelves at once, so that emphasis reads as emphasis — the Dig view is shelves, not a triage inbox.
22. As a DJ, I want Dig suggestions to act by jumping me to the right surface — audition loads the pair onto the Decks (Performance view), review opens the Take in the Transition editor, seed/extend opens the Set view — so that Dig is a launchpad, not another editor.
23. As a DJ, I want auditioning from the Dig view to feed Take capture as usual, so that using the view generates the evidence that sharpens the view.
24. As a DJ, I want run/chain suggestions involving my loaded Track to appear ambiently in the Performance view alongside Follow mode, so that mid-session brainstorming needs no view switch.
25. As a DJ, I want Takes captured from the same session to be grouped reliably (not guessed from timestamps), so that run mining is trustworthy going forward.
26. As a DJ, I want my pre-existing Takes still minable by a best-effort time-adjacency fallback, so that history recorded before session stamping isn't dead data.

## Implementation Decisions

- **One suggestion engine, pure and client-side.** All derivation — Unplaced scope, Observed pairs, run mining, chain proposals, wildcard sampling — is pure frontend functions over already-fetched data (tracks, takes, transitions, track-links, sets/entries), in a new `dig` model layer beside the pure follow model, per the same isolation rationale as the follow-mode and match-score PRDs. No backend discovery service; wholesale-list endpoints stay the seam. Backend scoring remains the answer for a library 100× current size; not now.
- **Observed derivation**: from the Takes metadata list — ordered pairs with Take count ≥ floor (tunable constant, default 2), excluding pairs that are Known (Link or saved Transition; exclusion at the unordered-pair level, matching Known's definition). Cameo Takes, when they exist, count for nothing until promoted. Carries Take count and latest `detected_at` for intra-tier ordering.
- **Follow-mode integration**: Observed becomes a stratum in the one total candidate order — Known strata, then Observed (by Take count, then recency), then the heuristic stratum. Pinned above column sorts like Known; excluded by "known only"; bypasses heuristic gates the way Known does. Composes with the match-score PRD's shared comparator: whichever lands first, the other edits the same pure-model seam.
- **Unplaced scope**: derived client-side — active (non-Archived) tracks minus every track appearing in any Set's entries. No backend `in_any_set` predicate, no new query param. Blunt by choice: any Set graduates, no active-Set notion until old-Set pollution bites.
- **Take capture session**: new nullable column on the Take model — a client-generated session UUID stamped by the capture detector, one per capture session (the session clock Takes already share, made explicit). Alembic migration; takes router round-trips it. Pre-existing Takes are sessionless.
- **Run mining**: group Takes by capture session (fallback for sessionless Takes: `detected_at` gap threshold, tunable), order within a session by window start; a Played run is a maximal sequence of Takes where each incoming Track is the next Take's outgoing Track. Shelf shows runs of ≥ 2 adjacencies, newest first. A run is acted-on (and drops off) when some Set contains its Track sequence consecutively.
- **Chain candidates**: directed edges = saved Transitions (their direction), Observed pairs (their direction), Links (both directions); nodes scoped to the Dig view's current scope+filters. Simple bounded path search (length caps, count caps — tunable heuristics); exact already-played runs and acted-on sequences excluded. Never persisted.
- **Wildcard sampler**: pure function over scope+filters with injected randomness; alternates neglected-track form (anti-ranking: oldest import, no evidence, never auditioned) and untried-pair form (Compatible, zero Takes). Reroll resamples; never blends into ranked shelves.
- **Dig view**: a new top-panel mode (sibling of library / Performance / Transition editor / Set view). Shelves in default order: Played runs, Observed pairs, Chain candidates, untried edges, Wildcard. Duplicates across shelves allowed. Filter chips are component state, never persisted. Actions navigate: Load pair → Performance view; review Take → Transition editor; seed/extend → Set view.
- **Ambient rail**: the Performance view surfaces run/chain suggestions involving a loaded Track, drawn from the same engine. Small, dismissible, secondary to Follow mode's list.
- **Seed Set from Played run**: existing endpoints — create Set, then the client-authoritative entries replace with each adjacency pinned `take`/that Take's uuid. Per the amended doctrine, this is a deliberate act naming the run's evidence; bulk auto-fill still never pins Takes. Default Set name derived from the run's date.
- **Seed Set from Playlist**: already exists (frontend flow, unpinned entries, source untouched). In scope only to verify it satisfies the graduation story; no bulk-conversion UI — the one-time migration is a dozen manual gestures.
- Glossary was updated in the grilling change (2026-07-08); no further CONTEXT.md work in this PRD.

## Testing Decisions

- Good tests here assert external behavior of pure functions and HTTP endpoints — inputs to outputs — never store internals or component wiring.
- **Pure dig model (vitest, prior art `follow/model.test.ts`, `suggest.test.ts`)**:
  - Observed: floor behavior (1 Take excluded, 2 included), Known exclusion (Link or saved Transition removes the pair), ordering by count then recency, directionality.
  - Unplaced: Archived excluded, Set membership graduates, Playlist membership doesn't, no recency expiry.
  - Run mining: session grouping, incoming→outgoing continuity, maximality, ≥2-adjacency floor, sessionless fallback gap threshold, acted-on exclusion.
  - Chains: edge directionality (Links bidirectional, Transitions/Observed directional), caps, played-run exclusion.
  - Wildcard: determinism under injected RNG, form alternation, filter-chip respect, anti-ranking selection.
  - Follow comparator: Observed stratum position, pinned-above-sort, "known only" exclusion.
- **Backend (pytest, prior art `tests/test_takes_router.py`, conftest's alembic-built in-memory DB)**: capture-session column round-trip on the takes router; migration keeps a single alembic head (the one hard invariant).
- Set seeding exercises existing, already-tested endpoints (`tests/test_sets_router.py`); new tests only for the run→pinned-entries payload derivation in the pure model.

## Out of Scope

- Backend suggestion service or `in_any_set` query param — client-side derivation until scale forces otherwise.
- An active/archived notion on Sets (the graduation predicate stays blunt).
- Bulk Playlist→Set conversion UI.
- Cameo Takes contributing to Observed, and Cameo edges in chains (Cameos are unimplemented; their PRD stands alone).
- A persisted pool, saved chains, or any "remember this run" artifact — evidence is the only persistence, by decision.
- Practice mode, per-shelf tuning UI, and Wildcard forms beyond the two decided.
- Ranking jitter anywhere (explicitly rejected).

## Further Notes

- Suggested tracer order for slicing: Observed tier (pure model + Follow integration — immediately useful, zero UI surface), capture-session column, run mining + Played-runs shelf in a minimal Dig view shell, seeding from run, remaining shelves, Wildcard, ambient rail.
- The match-score PRD (`docs/prds/match-score.md`, ready-for-agent) edits the same follow-model seam; whichever implements second must integrate with the other's comparator rather than fork it.
- Handover detection's liberal posture is why the Observed floor exists; if false positives still leak through at floor 2, the knob is the floor and Take confidence, both tunable heuristics.

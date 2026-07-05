# PRD: Linked pairs

Status: ready-for-agent

Glossary: **Linked**, **Known**, retired **Preferred pair** — see CONTEXT.md (2026-07-05 entries).

## Problem Statement

While practicing or performing, the DJ constantly discovers that two tracks go well together. Today the only way to record that judgment is to sketch and favorite a Transition — heavyweight when the insight is just "these belong together." The knowledge evaporates, and discovery (Follow mode) can only rank by heuristics or by pairs that happen to have saved Transitions.

## Solution

A **Linked** toggle: whenever two Tracks are loaded together (Performance view, Transition editor), one tap records the symmetric assertion "these go well together." Links surface as chain-link marks on library rows relative to the loaded Tracks, and feed discovery's **Known** tier — the union of Linked pairs and pairs with saved Transitions, ranked favorited Transition > Linked > unfavorited Transition. Linked is write-independent of Favorite; when a pair has a favorited Transition but no Link, the toggle hints that the pair is linkable.

## User Stories

1. As a performing DJ, I want to tap a toggle while two Tracks are loaded in the Performance view, so that I can record "these go well together" without leaving the mix.
2. As a DJ in the Transition editor, I want the same toggle in the editor toolbar, so that I can link a pair the moment a sketch proves they work.
3. As a DJ, I want the toggle to reflect the stored Linked state of the loaded pair at all times, so that I can see at a glance whether I've already linked them.
4. As a DJ, I want tapping the toggle again to unlink the pair, so that I can reverse a judgment I no longer hold.
5. As a DJ, I want Linked to be symmetric, so that linking A with B is the same fact regardless of which deck holds which Track.
6. As a DJ, I want a Link recorded in the Performance view to show as Linked in the Transition editor (and vice versa), so that the assertion is one fact, not per-surface state.
7. As a DJ, I want the toggle disabled when only one Deck is loaded or both Decks hold the same Track, so that I can't record meaningless self-links.
8. As a DJ, I want the toggle to hint when the loaded pair has a favorited Transition but no Link, so that I can promote proven pairs with one tap.
9. As a DJ, I want favoriting or unfavoriting a Transition to never silently change Linked state, so that each signal keeps the meaning I gave it.
10. As a library curator, I want a chain-link mark on library rows that are Linked to either loaded Track, so that I can see pair knowledge while browsing.
11. As a library curator, I want the chain-link mark to appear alongside the existing directional Transition marks (◆/★) without replacing them, so that I can distinguish "linked" from "has a Transition" at a glance.
12. As a DJ using Follow mode, I want Linked Tracks of the followed Track included in the Known tier, so that pairs I've asserted surface as candidates even when heuristics would exclude them.
13. As a DJ using Follow mode, I want a "known only" filter (replacing "proven only") that narrows to Linked ∪ saved-Transition candidates, so that I can browse only pairs I already trust.
14. As a DJ using Follow mode, I want Known candidates ranked favorited Transition > Linked > unfavorited Transition (a pair takes its best), so that the strongest evidence sorts first.
15. As a library curator, I want Links to persist across sessions, so that pair knowledge accumulates into set-building material.
16. As a library curator, I want Links to an Archived Track to persist but stop surfacing (marks, Follow candidates), so that archival hides without destroying, consistent with everything else.
17. As a DJ, I want the toggle to still work when a loaded Track happens to be Archived, so that archival never blocks curation edits.
18. As a library curator, I want replacing a Track's audio to leave its Links untouched, so that Links behave like Tags and Hot Cues.
19. As a DJ, I want the toggle to respond instantly (optimistic) with persistence in the background, so that linking never interrupts a performance.

## Implementation Decisions

- **Storage**: new table for the Linked edge — one row per unordered pair of distinct Tracks, stored canonically (`low_track_id < high_track_id`) with a unique constraint and `created_at`. Bare edge: no note, no strength. FKs to tracks with cascade delete. New Alembic migration (rev 0017, jj-suffixed per convention).
- **API**: mirrors the transitions router's minimal shape (ADR 0011 spirit): `GET /api/track-links` returns all links (boot load); `PUT /api/track-links/pair/{a}/{b}` with a `linked` boolean idempotently sets/clears. The server normalizes pair order and rejects self-pairs and unknown Track ids.
- **Client state**: a `linkStore` module store following the `pairStore` idiom — one boot GET, `useSyncExternalStore` subscription, optimistic toggle with write-through PUT.
- **Pair-knowledge index**: the client-side transition index is extended so one lookup answers saved / favorited / linked for a pair; marks, the linkable hint, and Known ranking all read from it. No new backend query endpoints — the index stays client-side, per the existing architecture.
- **Toggle surfaces**: exactly two — the Transition editor toolbar (beside the Favorite star) and the Performance view (both Decks loaded with distinct Tracks). No other toggle surface in v1.
- **Linkable hint**: when the pair has ≥1 favorited Transition and no Link, the unset toggle renders a hint state. The hint is a display state only; it never auto-links.
- **Write independence**: favoriting never links; unfavoriting never unlinks. Discovery computes the effective "goes well together" set as a query-time union.
- **Row marks**: a symmetric chain-link icon per loaded Track (A and B mark columns), rendered alongside the existing directional ◆/★ Transition marks.
- **Known tier**: the existing "proven" filter (transitions-from-loaded-decks) is renamed and redefined as **Known** = Linked ∪ saved Transition. Strength ordering within Known: favorited Transition, then Linked, then unfavorited Transition; a pair matching several takes its best. Exposed as a pure ranking helper for Follow-mode tier ordering (pending follow-mode issues 03/04 consume it).
- **Lifecycle**: no special cases. Archived suppresses surfacing via existing default filtering, not via Link logic; the toggle remains functional; Replace Audio leaves Links untouched.
- **Direction**: Linked carries no direction. "A into B works but B into A doesn't" remains the Transition tier's job.

## Testing Decisions

- Tests exercise module interfaces and external behavior only (ADR 0002); no mocking library; backend DB is in-memory SQLite built via `alembic upgrade head`.
- **Router tests** (pytest): the track-links router via TestClient — list, set, clear, idempotency, order normalization (PUT b/a equals PUT a/b), self-pair and unknown-id rejection, cascade on track delete. Prior art: the transitions router tests.
- **Migration**: covered implicitly by the conftest `upgrade head` engine; a dedicated migration test only if data transformation were involved (it isn't).
- **Frontend pure-module tests** (vitest, colocated): linkStore (boot, optimistic toggle, write-through), the extended pair-knowledge index (linked/saved/favorited lookups, symmetric access), Known filter membership and strength ranking in the follow model. Prior art: the pairStore, transitionIndex, and follow model test files.
- UI wiring (toggle placement, hint rendering, marks) is verified by the pure model tests plus manual demo; no component snapshot tests, matching existing practice.

## Out of Scope

- Unlink/link from library-row context menus or any non-loaded-together surface (deferred by design, not designed out — the row marks give it a future anchor).
- A Linked-pairs browser or "all Links" view.
- Any payload on the edge (notes, strength) beyond `created_at`.
- Set-building features consuming Links (Mix, future).
- Full Follow-mode tier ordering across Key tiers and best-tier-wins (follow-mode issues 03/04); this PRD only delivers the Known definition, filter, and ranking helper they consume.
- Exporting Links to external libraries (no Engine/Rekordbox counterpart exists).
- Controller mapping for the toggle.

## Further Notes

- Vocabulary landed in CONTEXT.md on 2026-07-05: **Linked**, **Known** (replacing "proven"), **Preferred pair** retired, and track-identity's "Link" renamed **External Correspondence** to free the name.
- Pending follow-mode issues (proven tier folded in; tier ordering) predate this vocabulary; whoever picks them up should read them as Known-tier work and build on this feature's ranking helper.
- `models.py` and the `main.py` router list are additive-append hotspots per the parallel-work rules.

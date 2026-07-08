# PRD: Match score

Status: ready-for-agent

## Problem Statement

Discovery over-relies on harmonic mixing. Compatible is a conjunction of hard gates — key ∈ {same, ±1 wheel, relative} AND BPM window — and the heuristic ranking is nothing but key relations (tiers: same, relative, +1, −1, rest). Key is therefore both the gate and the entire ranking: a candidate sharing the reference's artist, four Tags, and its exact energy is invisible on a key mismatch, while a bare same-key track with nothing else in common ranks near the top. In dnb the harmonic content is variable enough that nominal clashes (9m→1m) often play fine — the gate excludes real candidates for a distinction the ear frequently can't hear. The follow-mode PRD marked its tiering provisional and isolated it in the pure follow model precisely so this redesign would be cheap.

## Solution

A hybrid: the Known strata stay sacred on top (confirmed evidence is never outscored by heuristics), and the heuristic stratum becomes a single Compatible tier ordered by a **Match score** — a weighted sum over five signals: key relation, Tag overlap, Shared artist (all **affinity signals** — evidence two Tracks go together) plus BPM proximity and energy neighborhood (**context signals** — evidence the blend is mechanically comfortable). The candidate gate shrinks to BPM alone, with dyadic (half/double-time) folding. An **Affinity floor** keeps noise out: a candidate's affinity signals alone must score at least what the weakest compatible key relation would — context signals order, but never admit. Key becomes a bonus with a zero floor: a clash earns nothing and costs nothing. One total edge order (Known strata, then score, floor as the cut) is shared by Follow ordering and Set-building suggestions.

## User Stories

1. As a DJ, I want a keyless or key-clashing track that shares my playing track's artist and several Tags to appear in the followed list, so that harmonic mixing stops hiding good candidates.
2. As a DJ, I want the heuristic stratum ordered by overall match strength rather than key relation alone, so that a many-signal candidate outranks a bare same-key one.
3. As a DJ, I want a track at double or half the reference tempo (87 hip-hop under 174 dnb) to pass the gate and score its BPM proximity after folding, so that half-time moves are first-class.
4. As a DJ, I want more shared Tags to always score higher — steeply at first, gently forever — so that "many tags match" reads as the strong signal it is without a heavily-tagged track dominating.
5. As a DJ, I want artist matching to survive `feat.`/collab/typo mess (`Sub Focus` vs `Sub Focus feat. Kele`, `Camo & Krooked` vs `Camo and Krooked`), so that the messy library doesn't defeat the signal.
6. As a DJ, I want energy within ±1 to count (a rise slightly over a drop) and ±2+ to count for nothing, so that the energy neighborhood is honored without direction dominating.
7. As a DJ, I want no candidate admitted on BPM+energy comfort alone — the Affinity floor demands at least compatible-key-grade evidence from key/tags/artist — so that the list bottom isn't noise.
8. As a DJ, I want a track missing key, Tags, or energy to be unboosted but never punished, so that Unprocessed tracks aren't buried below genuinely clashing ones.
9. As a DJ, I want the score as a sortable column, the heuristic stratum's default sort, so that I can see match strength and still sort by BPM/title when I choose — with the Known strata pinned on top regardless.
10. As a DJ, I want Set-building append/insert suggestions ranked by the same order (weaker edge first, tie-break stronger), so that Follow and suggestions never disagree about what matches.

## Implementation Decisions

- **One total edge order, two consumers.** A shared comparator: Known strata in Known-strength order (favorited Transition, favorited Cameo, Linked, unfavorited Transition, unfavorited Cameo; a pair takes its best), then Compatible candidates descending by Match score, below-floor excluded. Follow ordering and `suggest.ts` edge ranking both consume it; `edgeTier` is retired. The weaker-edge/tie-break-stronger insert rule and the top-20 cut survive verbatim; the floor replaces the old rest-tier cut.
- **Score is a pure frontend function** `(reference, candidate, known) → number` beside the retiring `followTier` in the pure follow model — same deliberate isolation, trivially unit-testable, weight-tuning is a pure-function edit. Backend scoring is the answer for a library 100× the current ~1000 tracks; not now.
- **Weighted sum of normalized contributions.** Starter allocation (tunable heuristics, all of it): Tag overlap 30, key relation 25, Shared artist 20, energy 15, BPM proximity 10. Curves:
  - Key: same 1.0, relative 0.8, +1 wheel 0.7, −1 wheel 0.6, everything else 0. Never negative.
  - Tags: log-shaped in shared count (e.g. `log2(1+n)` normalized) — monotone, never flat.
  - Artist: binary — any fuzzy token match = 1.
  - Energy: ΔE 0 → 1.0, +1 → 0.9, −1 → 0.7, |ΔE| ≥ 2 → 0.
  - BPM: flat 1.0 within ~2% of the folded center, then linear decay to the gate edge.
  - Missing data contributes 0 everywhere (neutral, never negative).
- **Affinity floor**: the key+tags+artist subtotal must reach the weakest key-relation bonus (−1 wheel's contribution). Context signals (BPM, energy) order but never admit. Known candidates bypass floor and gate, as they bypass gates today.
- **Gate: BPM only, dyadic fold.** Candidate passes if its BPM is within threshold of the center, center×2, or center÷2; proximity is measured against the nearest fold, no half-time discount. NULL-BPM candidates stay excluded from the heuristic tier (a gate needs a tempo to test; neutrality is a score principle, not a gate one). Backend follow-query derivation drops the key/tag/energy filters and the harmonic-key set.
- **Uncap the follow candidate query.** The 1000-row parity truncation would silently drop candidates before scoring now that the gate is loose; at ~1000 tracks, fetch all gated candidates.
- **Prerequisite: key authority** (`key-authority/01`, open). The key-relation ladder is the same knowledge as `getHarmonicKeys`, already triplicated (backend `key.py`, `keyUtils.ts`, `Library.tsx`); consolidate rather than add a fourth copy.
- **Shared artist**: split artist strings on separators (`feat.`, `ft.`, `&`, `and`, `,`, `x`, `vs`), normalize, compare token pairs by normalized Levenshtein with a threshold. Whole-string fuzzy rejected (misses the structural feat./collab mess, the common case). Remixer-extraction from titles deferred.
- **Follow parameters modal slims**: the per-axis gate toggles (harmonic keys, energy preset, tags) are retired with the gates they controlled; BPM threshold and known-only remain. (Write-up call, not grilled: per-signal score toggles can return later if wanted — the score function makes them one-line weights.)
- **UI**: score as a sortable column, default sort of the heuristic stratum; Known strata pinned above with their existing section headers and marks; the key-relation tier headers (same/relative/up/down) retire with their tiers. No raw-score anxiety management beyond the column (badges deferred, see Out of Scope).
- Glossary updated in this change: **Compatible** rewritten (BPM gate + Affinity floor, signals never filter), **Match score** and **Shared artist** added, **Follow mode** ordering sentence revised.

## Testing Decisions

- Per ADR 0002: the pure follow model is the tested surface.
  - Score: per-signal contribution curves (key ladder incl. clash→0, tag log shape and monotonicity, energy asymmetry and ±2 cutoff, BPM flat-zone/decay/folding), missing-data neutrality, weighted composition.
  - Floor: admission requires affinity subtotal ≥ weakest-key bonus; BPM+energy alone never admit; Known bypasses.
  - Comparator: Known strata over any score, Known-strength internal order, dual-follow best-position-wins, stability under the view's sort.
  - Shared artist: tokenizer cases (`feat.`, `&`/`and`, comma collabs, order-swapped collabs), fuzzy threshold (typos in, distinct artists out).
  - Gate: dyadic fold cases (87 vs 174 passes; proximity measured on the fold).
  - `suggest.ts`: weaker-edge/tie-break-stronger over the shared comparator; floor as the cut.
- Backend: follow-query derivation drops non-BPM filters; dyadic gate; uncapped result.

## Out of Scope

- Remixer extraction from titles (`(X Remix)` as an artist token) — one regex, many title-cleanup edge cases; cheap follow-up.
- Tag Category weighting/scoping — remains the named escape hatch if flat categories prove too loose.
- Key clash penalty (negative contributions) — deliberately rejected: short blends, hard cuts, Key Lock, and dnb's variable harmonic content make nominal clashes playable; revisit only if garbage rises.
- Half-time proximity discount.
- Rating as a signal (a quality prior, not a match signal) and graph signals (shared Known neighbors) — the latter belongs to the deferred whole-set-generation future.
- Signal badges (per-row "why" marks: shared artist, `n` tags, key glyph) — add if the raw score column proves opaque during weight tuning.
- Backend scoring / any score persistence.
- Score threshold beyond the Affinity floor.

## Further Notes

- The affinity/context distinction is the design's load-bearing idea: gates are mechanical (can this blend physically ride?), evidence is musical (do these Tracks go together?). BPM is the only gate because it's the only mechanical constraint; the floor reads affinity only because comfort is not evidence.
- Sanity property of the starter weights: a perfect-key candidate with nothing else (25) loses to a keyless candidate with 3 shared tags + artist (~50) — the requested correction — while key still separates otherwise-similar cohorts.
- Everything contentious is a constant in one pure module: weights, curves, floor, fuzzy threshold, fold set. Tuning is editing numbers under test, not redesign.

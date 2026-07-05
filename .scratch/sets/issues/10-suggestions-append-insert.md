# 10 — Suggestions: append and insert

Status: ready-for-human

## Parent

.scratch/sets/PRD.md

## What to build

Track suggestions for Set building, reusing Follow-mode tiering (known tier: favorited Transition > Linked > unfavorited Transition; then Compatible key tiers), honoring Transition directionality. **Append**: candidates out of the last Track. **Insert** (between adjacent tracks): score both edges — out of the predecessor, into the successor — rank by the weaker edge, tie-break by the stronger. Tracks already in the Set are excluded. Pure ranking functions live beside the existing Follow model and are tested in that suite's style. UI: the Set toolbar's suggest affordance plus a per-adjacency insert affordance; accepting a suggestion appends/inserts the Track (pins via the usual auto-fill offer).

## Acceptance criteria

- [ ] Append ranking matches Follow tiering with direction respected
- [ ] Insert ranks by weaker edge; a both-edges-Compatible candidate outranks one great edge + one clash
- [ ] In-Set tracks never suggested
- [ ] Pure functions covered in the Follow-model test style
- [ ] Accepted suggestions land in the Set with auto-fill offered where a Transition exists

## Blocked by

- 01-set-model-sidebar-crud

## Comments

**2026-07-05 — implemented (lane setsugg, change tlrnwnvp), ready for human review.**

What was built:

- `frontend/src/follow/suggest.ts` — pure edge-tier ranking beside the Follow model: `edgeTier(from, to, known)` (tier numbers in lockstep with `followTier`/`tierLabel` by construction), `suggestAppend` (out of the last Track), `suggestInsert` (both edges; ranked by the weaker, tie-broken by the stronger; stable). Covered in `suggest.test.ts` (follow-suite style, 11 tests).
- `frontend/src/sets/SetSuggestions.tsx` — popover wiring evidence (direction-aware transition index, Links, library list); top 20, rest-tier candidates cut; accepting adds the Track only (pins via the existing auto-fill offers).
- Additive: `insertTrackIntoSet` in setStore (predecessor's pin rides along untouched, reorder policy); Suggest button in the Set header; `+ insert` affordance per adjacency row.

**Verification walkthrough** (lane app running):

- Open http://localhost:5283 (or `npm --prefix desktop start -- --port 5283`)
- Sandbox has a seeded Set "Suggest demo" = [track 9, 549, 171] with a real transition graph (549→171 fav, 171→600 fav, 171→780, 549→600…).
- Click the Set in the sidebar → header shows **Suggest** (blue). Click it: ranked list out of track 171 — expect "★ Favorited transition" for track 600, "◆ Saved transition" for 780; tracks 9/549/171 never listed. Click a row → appended, and the new adjacency shows the usual `↳ pin` auto-fill offer where a Transition exists.
- On the 549→171 adjacency row click **+ insert**: candidates score both edges (`out:` / `in:` chips), ranked by the weaker edge. Accept one → inserted between, both new adjacencies unresolved with auto-fill offers where applicable.
- Ranking semantics (direction, weaker-edge, tie-break, exclusion) are asserted in `frontend/src/follow/suggest.test.ts`.

Gate: pytest 633 ✓, vitest 789 ✓, build ✓, eslint clean on touched files, alembic single head ✓ (no migration). Feature stack parked on change `tlrnwnvp` pending approval.

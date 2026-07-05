# 10 — Suggestions: append and insert

Status: ready-for-agent

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

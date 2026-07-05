# 01 — Linked edge end-to-end: table, API, linkStore, editor toggle

Status: ready-for-agent

## Parent

.scratch/linked-pairs/PRD.md

## What to build

The Linked edge, thin but complete: a stored symmetric "these two Tracks go well together" fact, toggleable from the Transition editor toolbar.

- New table: one row per unordered pair of distinct Tracks, canonical order (`low_track_id < high_track_id`), unique constraint, `created_at`, FK cascade. Alembic migration 0017 (jj-suffixed).
- Router at `/api/track-links`: `GET` lists all links (boot load); `PUT /pair/{a}/{b}` with `linked: bool` idempotently sets/clears. Server normalizes pair order; rejects self-pairs and unknown Track ids.
- Frontend `linkStore` following the pairStore idiom: boot GET, `useSyncExternalStore`, optimistic toggle with write-through PUT.
- Toggle in the Transition editor toolbar beside the Favorite star (chain-link icon), reflecting and flipping the loaded pair's Linked state. Favorite and Linked stay write-independent.

User stories: 2–6, 9, 15, 19.

## Acceptance criteria

- [ ] Migration creates the table; `alembic heads` shows exactly one head
- [ ] PUT a/b then GET shows the link; PUT b/a addresses the same fact (normalization); repeat PUTs idempotent; `linked: false` clears
- [ ] Self-pair and unknown Track id rejected with 4xx; deleting a Track cascades its links
- [ ] Editor toolbar toggle shows current state, flips it optimistically, persists across reload
- [ ] Favoriting/unfavoriting a Transition never changes Linked state
- [ ] Router tests (TestClient, in-memory SQLite via upgrade head) and linkStore vitest tests pass; gate green

## Blocked by

None - can start immediately

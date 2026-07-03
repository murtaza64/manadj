# Refresh end-to-end: likes become visible Source Items

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## What to build

The tracer bullet. A Refresh action pulls the user's SoundCloud likes and persists them as Source Items (stable SoundCloud ID, title, uploader, duration, permalink, state — all start `new`). An Acquisition section appears in the existing Sync view with a Refresh button and a plain list of Source Items showing title, uploader, duration, and state.

The Source boundary is the feature's single seam: a SoundCloud source interface with a list operation (metadata only), implemented per the outcome of the likes-scanning research (issue 01), authenticated via OAuth token from config.toml. Refresh inserts by SoundCloud ID if absent; it never rewrites existing rows and never deletes (upstream metadata edits do not propagate — local state is authoritative once fetched).

Endpoint and module naming: use Acquisition vocabulary, not generic "sync" (see CONTEXT.md).

UI direction: the review-split layout chosen by prototype — sidebar (Refresh + filters) / item list / detail panel / bottom action bar. See the UI decision in the PRD. This slice needs only the skeleton: sidebar with Refresh, and the item list.

## Acceptance criteria

- [x] Refresh from the UI populates Source Items from the real SoundCloud account
- [x] Source Items persist across app restarts; re-Refresh is idempotent and only adds
- [x] Unliked-upstream items remain locally
- [x] Acquisition section renders in the Sync view with the item list and Refresh button
- [x] Module-interface tests with a fake SoundCloud source (Refresh persistence, idempotency, add-only); thin router smoke test (per ADR-0002 posture)

## Blocked by

- 01-investigate-likes-scanning.md

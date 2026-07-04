# Playlist entry identity: dedupe, unique constraint, track_id-keyed API

Status: ready-for-agent

## Parent

`.scratch/playlist-editing/PRD.md`

## What to build

Prefactoring slice (backend-only). Make `(playlist, track)` the identity
of a Playlist entry:

- Alembic migration that deduplicates existing playlist entries (keep the
  lowest position, compact positions to stay contiguous) and adds a
  unique constraint on the playlist/track pair.
- Remove-track and reorder endpoints key on `track_id` instead of the
  playlist-track row id; the row id disappears from all API contracts.
- Reorder payload becomes a typed list of `(track_id, position)` pairs
  (no untyped dicts).
- Adding an already-present Track becomes an idempotent no-op returning
  success with a "skipped" indicator, so callers can report skipped
  counts on bulk adds. Positioned insert behavior is preserved.
- Frontend API client methods updated to the new contracts (no UI yet).

## Acceptance criteria

- [ ] Migration dedupes and constrains; a duplicate insert is impossible at the schema level
- [ ] Remove and reorder endpoints accept `track_id`; row ids appear nowhere in request/response schemas
- [ ] Duplicate add returns success + skipped indicator; positioned insert and remove-compaction still work
- [ ] Router tests via FastAPI TestClient (real in-memory SQLite, acquisition-router pattern) cover: duplicate add no-op, positioned insert, remove + compaction, typed reorder, malformed reorder rejected
- [ ] Migration follows repo conventions (sequential number + jj short id rev-id)

## Blocked by

None - can start immediately

## Comments

Done (jj rmwnmxnk). Migration 0010_rmwnmxnk dedupes + compacts + unique
index; add is idempotent (`{skipped, playlist}` response); remove/reorder
key on track_id; reorder validates full permutation (400 otherwise);
sidebar reorder payload typed. Also fixed a pre-existing append bug
(`(max_position or -1) + 1` collapsed position 0 to -1, so second appends
collided at 0 — masked by id-ordered ties). Router tests:
tests/test_playlists_router.py (9). Migration verified against the
sandbox clone (790 rows, 0 dupes, contiguity holds).

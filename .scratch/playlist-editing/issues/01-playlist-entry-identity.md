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

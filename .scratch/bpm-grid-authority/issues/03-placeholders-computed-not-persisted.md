# 03 — Placeholders are computed projections, never persisted by reads

Status: ready-for-agent
Type: task

ADR 0027 §3. A placeholder is a grid-shaped view of the column — same
number by definition, zero extra information (`crud.py:621-648` derives
it from `track.bpm`). Persisting it created a second copy that could
freeze stale (the bpm_effective-serves-frozen-placeholder bug).

## Change

- `GET /api/beatgrids/{track_id}` (`routers/beatgrids.py:28-48`): for
  gridless tracks, compute the placeholder response on the fly (same
  shape, `origin: "generated"`), do NOT insert a row. Kills the
  read-side-effect commit.
- Nudge/set-downbeat on a gridless track: create the row at gesture time
  (nudge's auto-create at `routers/beatgrids.py:145-147` already does
  this) and promote to `edited` as today — deliberate gestures are the
  only row creators, alongside import and re-tempo.
- Authority chain everywhere: `origin != "generated"` grid → dominant
  tempo; else column (coordinate with issue 01).
- Sweep for code assuming a row exists after GET.
- Optional data cleanup in the backfill script (issue 01): delete
  persisted `generated` rows whose tempo equals the column (pure
  derivations); keep any that diverged only long enough to reconcile the
  column first.

## Testing decisions

- GET on a gridless track returns a placeholder payload and writes no
  row (assert beatgrid count unchanged).
- write_bpm behavior on gridless/placeholder/edited unchanged
  (existing `tests/test_beatgrids_router.py` suite stays green).
- Nudge on a gridless track creates + promotes exactly one row.

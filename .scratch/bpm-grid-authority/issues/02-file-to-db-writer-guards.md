# 02 — File→DB BPM never overwrites a gridded track; compare vs grid-first

Status: ready-for-agent
Type: task

ADR 0027 §1. The two HIGH-severity divergence pumps from the audit.

## Change

- `refresh_from_files` (`backend/track_metadata/manager.py:116`): skip the
  BPM write when the track has a real (non-generated) grid; other fields
  unchanged. Placeholder-only or gridless: route BPM through
  `beatgrid_ops.write_bpm` (regenerates placeholders per ADR 0016).
- `sync_to_db` (`manager.py:213-217`): same guard, same routing.
- `compare_with_files` (`manager.py:149`): diff file BPM against the
  grid-first projection (issue 01's served value), not the raw column —
  kills the perpetual phantom "fix the DB" proposal for gridded tracks.
- No override affordance for gridded tracks (grill decision): re-tempo
  via the BPM control is the deliberate gesture.

## Testing decisions

- Gridded track + file with different BPM: refresh/sync-to-db leave both
  grid and column untouched; title/artist/key still update.
- Placeholder-only track: file BPM regenerates the placeholder and
  updates the column (via `write_bpm`).
- Compare: gridded track whose file matches the GRID shows no BPM
  divergence even when the internal column is stale.

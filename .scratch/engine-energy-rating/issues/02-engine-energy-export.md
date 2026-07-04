# Energy export to Engine — star ratings ride the Engine tag export

Status: closed (implemented change vzzwooow)

## What to build

Export direction: the Library's Energy reaches Engine DJ as a star rating, riding the whole-library "Export tags → Engine" operation exactly as it rides Rekordbox's (where the tag export writes energy colors + an Energy MyTag). For every matched Engine track, the export sets Engine's rating to the Library energy via the encoding from issue 01. An empty Library energy never overwrites an Engine rating — the field is skipped, per the Export rule.

Writing the rating column on existing matched tracks is a simple-column update, consistent with ADR 0006 (only Engine track *insertion* is forbidden; tag/playlist export already writes Engine's DB directly).

UI: the "tags diverged" group's "Export tags → Engine" button must also appear when the group holds only energy divergences against Engine (Rekordbox got the same fix), and its side-effects text mentions star ratings.

## Acceptance criteria

- [ ] Engine tag export sets Track.rating = energy × 20 for matched tracks with Library energy set
- [ ] Empty Library energy never overwrites: Engine rating untouched for those tracks
- [ ] Include-energy behavior is optional in the export call, mirroring the Rekordbox writer's shape
- [ ] After an export, a previously energy-diverged Engine row compares in sync
- [ ] "Export tags → Engine" group button appears for energy-only divergences; side-effect text mentions ratings
- [ ] Tests cover rating writes, the never-overwrite-with-empty rule, and idempotent re-export
- [ ] Typecheck and full test suite pass

## Blocked by

- 01-engine-energy-read

## Comments

**2026-07-04 — Done** (jj change `vzzwooow`, lane energyrating). `EngineTagWriter._export_energy_ratings`: active tracks with energy, matched via the existing TrackIndex, `Track.rating = energy_to_rating(energy)`; only-tracks-with-energy satisfies never-overwrite-with-empty by construction; energy step runs even with zero tag categories. `include_energy` threaded through `sync_to_engine` and the router (`TagSyncRequest.include_energy` no longer Rekordbox-only); new `TagSyncStats.tracks_rated` counts actual writes (0 on re-export = idempotent). UI: div-tags group buttons count `tags|energy` divergences for both targets; Engine side-effect text mentions star ratings. Tests: 9 writer tests on a schema-real in-memory Engine DB (ADR 0004 pattern, first use) incl. an export → `compute_sync_status` round-trip through the real `EngineSurfaceReader`.

Review notes: `tracks_unmatched` can double-count a track unmatched in both the tag and energy passes — pre-existing per-tag inflation, left as is. Negative ratings decode as absent rather than clamping to 1 (saner than the issue's strict wording; documented in `enginedj/ratings.py`).

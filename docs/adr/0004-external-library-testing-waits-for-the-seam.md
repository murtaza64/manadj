# External-library testing waits for the seam

Status: accepted; still deferred (architecture-deepening/02 collapsed the shared Match/in-sync primitives but did NOT deliver the read/write Surface seam — see the amendment)

Sync managers will be tested against a `FakeExternalLibrary` once the `ExternalLibrary` interface exists; the enginedj/rekordbox adapters get a small number of tests against schema-real SQLite databases generated from those packages' own SQLAlchemy models (`metadata.create_all`), covering the corruption-prone invariants (Engine's playlist-entity linked list, UUID ritual). No Engine `m.db` or Rekordbox binary fixtures are committed to the repo — they're opaque, Engine-version-coupled, and rot. Until the seam exists, sync code remains untested and manual dry-runs against real libraries stay the pre-Export practice.

## Amendment (2026-08-18, architecture-deepening/02): partial — Match/in-sync only

The write-path Surface seam this ADR waits on was **not** delivered. The attempt
built a read/write `Surface` interface with Engine/Rekordbox/Fake adapters and a
`reconcile(source, target, direction)` engine, but nothing consumed the write
verbs or `reconcile` — a hypothetical seam with no live production caller
(Speculative Generality). Under the deletion test it was removed rather than
shipped as dead code.

What DID ship — a genuine de-triplication of two Match kin, now single-homed in
`backend/sync_common/matching.py` (the existing "single home of Match") and
consumed by the managers:

- `match_by_key` — Match generalized off the track-path special case; consumed
  by `tags/comparison.match_tags_by_name` and
  `playlists/matching.match_playlists_by_name` (which had duplicated the
  bucket-by-name logic).
- `in_sync` — the agreement predicate `TagSyncManager._check_if_synced` and
  `PlaylistSyncManager._check_if_synced` each defined separately.
- `TrackSyncManager`'s two ~70-line engine/rekordbox near-duplicate discrepancy
  methods folded into one `_discrepancies` engine.
- The write-path endpoint triad (`manadj`/`engine`/`rekordbox`) single-homed as
  `SYNC_ENDPOINT_IDS` in `sync_status/models.py` and consumed by the managers.

Tests: `tests/test_sync_manager_matching.py` pins the shared Match/in-sync
behavior through the managers' own methods (reader/DB seam substituted per ADR
0002). No FakeSurface: there is no Surface to fake.

Still outstanding (this ADR's deferral stands):
- No read/write `ExternalLibrary`/`Surface` interface exists yet. Vendor
  internals still leak into the managers (`tags/engine_writer.py` imports
  `enginedj.*`; Engine's `session_m()` and Rekordbox's DB-object/`commit`
  lifecycles still surface in the managers). `reconcile(library, surface,
  direction)` — the write engine the original issue asked for — is not built.
- The sync managers' **write** paths are therefore still untested end to end,
  and the schema-real Engine/Rekordbox adapter tests described above remain
  unwritten. A future issue must build the actual write seam (or the write path
  stays on manual dry-runs).

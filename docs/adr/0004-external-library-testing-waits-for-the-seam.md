# External-library testing waits for the seam

Status: accepted (deferred execution — depends on the ExternalLibrary seam, architecture-review candidate 3)

Sync managers will be tested against a `FakeExternalLibrary` once the `ExternalLibrary` interface exists; the enginedj/rekordbox adapters get a small number of tests against schema-real SQLite databases generated from those packages' own SQLAlchemy models (`metadata.create_all`), covering the corruption-prone invariants (Engine's playlist-entity linked list, UUID ritual). No Engine `m.db` or Rekordbox binary fixtures are committed to the repo — they're opaque, Engine-version-coupled, and rot. Until the seam exists, sync code remains untested and manual dry-runs against real libraries stay the pre-Export practice.

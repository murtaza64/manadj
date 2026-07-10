# Engine track Export goes through RBXML, not direct DB insertion

**AMENDED 2026-07-10: reversed — Engine track Export now writes m.db
directly.** The library-sync-button/08 spike (docs/research/
enginedj-write.md) falsified this ADR's premise: the "bare Track row is
not enough" failure was a single NULL — Engine's browser refuses to
hydrate a Track row whose `albumArtId` doesn't reference an AlbumArt row
(an empty row suffices). With that satisfied, a minimal metadata row
renders, plays, and is auto-analyzed by Engine on first load; m.db's own
triggers handle the origin-UUID ritual, PerformanceData row creation,
and id-recycling protection. Direct insertion lives in
`enginedj/track_export.py` (Engine-closed guard + once-per-run Database2
snapshot, mirroring `rekordbox/perf_export.py`); the RBXML generator,
`rekordbox/xml.py`, and the manual-import UI affordance are deleted. The
playlist-entity linked-list caution stands — playlist writes still go
through the dedicated writers.

---

Original decision (2026-07-02, superseded):

Rekordbox presence Export writes rows directly into the Rekordbox database (pyrekordbox tolerates minimal rows; "Reload Tag" fills the rest), but Engine DJ presence Export deliberately generates a Rekordbox XML file that the operator imports manually inside Engine DJ. A direct-insert implementation existed (scripts/sync/engine_tracks.py, deleted 2026-07-02) and was abandoned: a bare Track row is not enough for Engine — its importer owns analysis data, performance data, and file handling, and our inserts risked corrupting the corruption-prone parts of the schema (playlist entity linked lists, NOT-NULL conventions). Tag and playlist Export still write Engine's DB directly — those tables are simple; track ingestion is not.

## Consequences

- ~~The unified sync view labels the two Exports differently: Rekordbox applies immediately; Engine generates an artifact plus a manual step, and rows honestly remain "missing downstream" until the operator completes the import and the view refreshes.~~ Both Exports now apply immediately; Engine's requires Engine closed (409 otherwise) and rows leave "missing downstream" on the next refresh.
- Symmetric direct insertion could be revisited once persistent Links to Engine track IDs exist (.scratch/track-identity/01). *(2026-07-10: done, without waiting for Links — Match by path still pairs the rows.)*

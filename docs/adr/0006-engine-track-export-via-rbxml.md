# Engine track Export goes through RBXML, not direct DB insertion

Rekordbox presence Export writes rows directly into the Rekordbox database (pyrekordbox tolerates minimal rows; "Reload Tag" fills the rest), but Engine DJ presence Export deliberately generates a Rekordbox XML file that the operator imports manually inside Engine DJ. A direct-insert implementation existed (scripts/sync/engine_tracks.py, deleted 2026-07-02) and was abandoned: a bare Track row is not enough for Engine — its importer owns analysis data, performance data, and file handling, and our inserts risked corrupting the corruption-prone parts of the schema (playlist entity linked lists, NOT-NULL conventions). Tag and playlist Export still write Engine's DB directly — those tables are simple; track ingestion is not.

## Consequences

- The unified sync view labels the two Exports differently: Rekordbox applies immediately; Engine generates an artifact plus a manual step, and rows honestly remain "missing downstream" until the operator completes the import and the view refreshes.
- Symmetric direct insertion could be revisited once persistent Links to Engine track IDs exist (.scratch/track-identity/01).

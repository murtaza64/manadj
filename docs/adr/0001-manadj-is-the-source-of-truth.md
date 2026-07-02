# manadj is the source of truth

manadj began as a reconciler between two peer libraries (Rekordbox and Engine DJ), and the codebase still contains bidirectional sync machinery with discrepancy detection and conflict resolution. We decided instead that manadj is where the library is curated — the single source of truth. Rekordbox and Engine DJ are external libraries: Sync operations against them are directional (mostly Export, occasionally Import), each with a clear winner, so no symmetric merge or conflict-resolution model is needed.

## Consequences

- Bidirectional sync code (`sync/`, parts of `scripts/sync/`, conflict-resolution paths in `backend/*/sync_manager.py`) is legacy relative to this decision.
- Import is an explicit, user-driven exception path, not an automatic merge.

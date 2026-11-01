# Scoped Library field review · #430

- Direction: Murtaza approved revised Library/Tracks design 2026-11-01; Coda relayed “better. lets build this”.
- Status: implementation candidate, not installed or released. #426 parent `b0c601913d481edfac51e29447b3e0387dfd0cce` independently clean; #430 requires its own review.
- Port: never (Android does not manage desktop Engine DJ/Rekordbox libraries; phone Device sync unchanged).

## UI and scope

- Library without a playlist offers Review fields; capture selected, filtered or all active Library IDs. Filter capture includes Follow projection across the complete returned set, not just the rendered first1000. Archived tracks require explicit archived-view selection/filter.
- Capture refuses incomplete lists above10000; it never truncates or treats an absent ID list as all tracks.
- Current Tracks inbox offers row/group review and filtered/all-active scopes through the same inspector. Existing distinct legacy operations remain labeled with their original scope; no legacy mutation is silently redirected or relabeled.
- Review freezes exact IDs, source/destination, direction and fields. No playlist membership/order, audio copy or missing-track creation is exposed. #417 integration stays separate.
- Import/export default to filling blank destination fields. Each saved or unknown destination field needs a separate track×field replacement choice. Empty sources preserve destination values; ordinary field review does not use full-playlist clear policy.
- Compact field/key rows and cue/grid geometry reuse `ExportFieldChanges`. Same-value fields propose no write in this field-only contract (unlike full-playlist rewrites).
- Expired, pending, changed-context, unavailable and blocked plans cannot Apply. Pending close/Escape and duplicate Apply are guarded. Recheck clears consent.

## Capabilities

| Direction/surface | Supported fields |
|---|---|
| Engine → Library | Title, artist, energy, key, hot cues, saved beatgrid, user Main cue |
| Rekordbox → Library | Title, artist, energy, key, hot cues, saved beatgrid |
| Library → Engine | Energy, key, hot cues, beatgrid, Main cue |
| Library → Rekordbox | Key, hot cues, beatgrid, Main cue |

- Disabled fields are explained, not mapped to wider operations. Tags/catalogue writers and standalone BPM writes remain outside this field-isolated slice. Rekordbox reader does not expose Main cue.
- Beatgrid import updates Library BPM projection and clears the old anchor through the existing persistence path.
- Rekordbox hot-cue export reconciles hot/memory cue mirrors. Destination-only memory cues can be deleted; the full prior set is unknown and replacement requires explicit consent. This does not claim native cue-file/player agreement.
- Engine selected-field export preserves unselected quick-cue members, grid, key and energy. Full-playlist callers retain existing defaults. Scoped writes do not set an unanalyzed track's analysis-ready flag.

## Contract and safety

- `POST /api/sync/fields/plan`: explicit `track_ids`, `scope`, `surface`, `direction`, `fields`; read-only.
- `POST /api/sync/fields/execute`: same context plus freshness `token` and explicit `replacements` (track ID + field).
- Token binds Library identity/media/source values, external path/reader state/DB-WAL-native revisions and exact scope/fields. SHM and empty-WAL observation lifecycles do not invalidate unchanged data.
- Execute observes again before dispatch. Per-destination export lease is shared with the playlist inspector; Library imports have a process-wide lease. Other processes/legacy endpoints are not transactionally excluded.
- Writers receive the validated path, not a new destination config lookup. Export gate remains server-authoritative; existing backup/app-closed checks stay in the native writers. Imports are not gated.
- Partial receipts retain each requested track×field outcome. Exceptions after dispatch or untyped results are unknown, not proof of no writes. Frontend validates exact receipt context, coverage and primitive status types.
- No jobs, cancellation, rollback, atomic cross-library transaction, safe retry or native playback verification is promised. Recheck is a new observation. Receipts are not durable job history.

## Verification/runtime

- Service/router tests use Alembic in-memory Library and fake external seams. Engine selected-field preservation tests use generated destination databases only.
- Production Library and actual Tracks entry wiring share the inspector; the LAN review uses a labeled Library scope table harness plus the actual Tracks component.
- `uv run scripts/agent/check_fields.py --url http://192.168.1.235:5434/` exercises real plan/execute and Library persistence with synthetic external adapters. It refuses a server without the fixture identity.
- Build: from `frontend`, `npm exec vite -- build --config scripts/review-fields430/vite.config.ts`.
- Serve: `uv run scripts/agent/review_fields.py --host 192.168.1.235 --port 5434 --assets /tmp/opencode/manadj-fields430-dist`.
- Live personal artifact: http://192.168.1.235:5434/ ; `/source.json` records the reviewed pin and adapter boundary. Latest log/PID are in the issue walkthrough. No Work Surface or installed app access.
- Exact source pin, verification counts and server PID belong in the issue walkthrough after final checks.

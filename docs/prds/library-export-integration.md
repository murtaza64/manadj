# Library export integration · #442

- Source of truth: GitHub #442; contracts #417/#422/#426/#430.
- Status: integrated development candidate; no landing, installed activation or real-library export authorization.
- Port: never (Android does not manage desktop Engine DJ/Rekordbox libraries; phone Device sync unchanged).

## Inputs and ancestry

- Main: `3defc5e189f91f899a427bd3934b0307d876a8c6`.
- Playlist creation #417: `931b3526d7c9e123c51e08af247fbfd531dead17`, source reviewed.
- Native cues #422: `e45006c3a26b8bf1c66742e836e29fa6f343850a` + corrected `91fb87b10845570315bf7c73f6692baa71d9b659`, corrected source reviewed.
- Scoped fields #430: `e98de060f6ede574bcf65be157f0c9e8f1a9038c` + corrected `37be22d8dec2e7846991d9089c23534bda63a754`, corrected source reviewed.
- Required #426 inspector ancestors: `bf1f75aa61dba7423d593e5aede5cea62751b88f`, `1bc89c2fa6424d2f6f2eb12e3d747f434e352894`, `58ffee3b4d059bad590c3007b28deaef60520b72`, `b776bebb96bad039635d5c09ae76248075e8d507`, `b0c601913d481edfac51e29447b3e0387dfd0cce`.
- Controlled issue merge explicitly retains those reviewed dependencies; it is not authorization to land the ancestry. No diagnostics/Android/peer/social/release/prototype ancestry included. Never-land `078e1d9d` excluded.

## Integration contract

- Library selected/complete-filtered/all field review keeps exact IDs, fields, independent replacements, blank preservation, target-path/revision binding and shared destination lease.
- Field-only execution never creates records, copies audio or changes membership/order. Missing records remain blocked. Separate playlist export can add records; Recheck then binds a new field plan and clears consent.
- Playlist inspector observes missing-record prerequisites through the same read-only source validator as #417. Planned additions and unavailable source audio are explicit. Acknowledgement covers additions/omissions as well as overwrites/removals.
- Partial playlist export omits unavailable entries while preserving source order of successful entries. Receipt covers every source track and confirmed additions, even if later membership/performance/native writes fail. No rollback or safe-retry promise.
- The obsolete full-export modal stays deleted. Its #417 addition/native-failure evidence is integrated into the current inspector. The legacy detail action remains import-to-Library only; external export uses the inspector.
- Engine merges path-aware matching and selected-field preservation. Neither full nor selected-field writes fabricate `isAnalyzed`; new unanalyzed records cannot gain cue/grid readiness from metadata writes.
- Corrected Rekordbox point-over-loop normalization and native cue synchronization run through the real field adapter. Authorized hot-cue reconciliation precedes selected Main cue in either request order. Full export retains its distinct clear/rewrite rules.
- Post-commit native failure retains DB-commit/native-file reason; field exceptions stay unknown. Partial DAT/EXT replacement is not pair-atomic. Same-value field review is not a native repair operation.
- Creation backups use the validated destination path. Export-disabled/app-open/backup/stale-context guards remain. Other processes/legacy endpoints are not globally transactionally excluded.
- Unsupported #430 fields remain disabled: tags/catalogue, scalar BPM, RB energy/title/artist export and RB Main-cue import. No missing analysis generation, encrypted-library/native app/player/USB compatibility claims.

## Verification and venue

- `tests/test_library_export_integration.py` exercises production readers/writers on migrated disposable Library, actual Engine/pyrekordbox schemas and generated DAT/EXT. No performance/tag stubs in these combined adapter cases.
- Covers missing-block → separate creation → stale-token rejection → replan/export → idempotent repeat on both targets; unavailable-audio partial receipts; both Main/hot orders; true loop-to-point conversion; source/native/path freshness; partial native replacement and pinned backup paths.
- Retain original #417/#422/#426/#430 regressions. Original DB-only ordering probe isolates native synchronization explicitly; combined native tests cover that added writer boundary. WAL lifecycle tests remain read-only.
- Full frontend/type/build checks, targeted backend, touched lint and one Alembic head are required. Broader backend baseline is not implied clean by focused passes. Exact results belong in the issue receipt.
- Review build uses the full production Library component, production routes/adapters and generated external DB/native files. It is not the old scope-table harness or simulated external success API.
- Build from `frontend`: `npm exec vite -- build --config scripts/review-library442/vite.config.ts --outDir <own isolated assets>`.
- Serve: `uv run scripts/agent/review_library_export.py --port <free port> --assets <own isolated assets> --pin <frozen pin>`; binds 127.0.0.1 and creates a fresh disposable root under `/tmp/opencode`.
- The server redirects host/library discovery to generated fixtures, uses unencrypted external SQLite and leaves real writer backup/closed-app functions in place. It does not start production background workers/device services. Playback/unrelated mutations are outside this review.
- `/source.json` names the pin and boundary. `/fixture/evidence` reads actual fixture DB/native contents and backup locations. The fixture gate/native-file controls accept no caller paths.
- `uv run scripts/agent/check_library_export.py --url <own fixture URL>` refuses other servers and mutates generated fixtures only. Use fresh fixture roots for repeat runs. Reviewer assets/processes must remain separate from author venues.

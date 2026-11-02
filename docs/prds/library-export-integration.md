# Library export integration · #442

- Source of truth: GitHub #442; contracts #417/#422/#426/#430.
- Status: integrated development candidate; no landing, installed activation or real-library export authorization.
- Port: never (Android does not manage desktop Engine DJ/Rekordbox libraries; phone Device sync unchanged).

## Sync workspace placement revision

- Decision: Murtaza selected REVISE on the prior EXPORT placement; source landing is not approved. The child of preserved `1036d7ee36b88c36359b337287249681aea79011` implements the bounded frontend revision allocated by Coda task73.
- Actual App SYNC opens Workspace by default. Destination/readiness/direction/scope occupy its rail; the center reuses track rows without Library playback or curation controls; field/playlist review and receipts stay embedded.
- Library field and playlist entries capture context then open SYNC. Exact IDs and source scope survive navigation; empty selection never becomes the whole Library. Complete filtered/all scopes refuse truncated or malformed responses. Keyboard rows remain reachable after filtering hides the focused track.
- Plan readiness is an observation, not connection/native playback proof. Engine and Rekordbox desktop use existing adapters; USB remains unavailable. Phone/peer setup remains Settings-owned.
- Target/scope/operation changes discard stale plans and consent. Pending execution locks local routing/context controls and duplicate execution; top-level mode changes keep the pending workspace mounted. Unknown outcomes require inspection and a fresh plan, not replay.
- Passive Library/playlist cache changes never replace the submitted inspector or discard its pending/success/error/unknown outcome. A changed implicit ID scope disables an unapplied field plan; explicit Recheck captures the current IDs. Explicit context changes remain locked until settlement; Clear/new review can replace the owner afterward.
- Recommendation: consolidate destination work under SYNC. This candidate retains legacy EXPORT and existing Tracks/Playlists/import tabs; retiring or redirecting EXPORT requires a separate explicit decision.
- Review choices after independent source QA: develop this placement, revise it, or park it. None authorizes source landing, installed activation, or device/media writes.
- Production backend/writers/USB/Android are unchanged from1036. The fixture host only adds truthful ffmpeg availability; other optional full-App services remain unmounted and may return403/404.
- Review build: `npm exec vite -- build --config scripts/review-sync442/vite.config.ts --outDir <own isolated assets>`. Serve using the fixture command below, then open `?view=sync`.
- Browser: `uv run scripts/agent/check_sync_workspace.py --url <fresh own fixture URL> --artifacts-prefix <own prefix>` runs actual App navigation, captured Library/playlist entry, real Engine/RB/native/playlist writes and backups, pending mode retention, keyboard/mobile, real gate/freshness rejection and injected transport failure. It never substitutes a successful plan or writer result.
- Browser qualification: headless MIDI denial triggers the existing App boot recovery's whole-page reload after3attempts. The checker seeds only its existing session recovery flag to prevent this unrelated reload from racing selection/receipt checks; no MIDI permission/device access or production MIDI behavior is changed. Selection and captured-ID assertions remain strict.

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
- Engine observation, playlist membership, scoped tags and performance dispatch share `enginedj.paths.absolute_track_path`: stored relative paths resolve against that DB's configured library root; lexical dots/separators normalize on both observation and lookup. Valid paths retain exact-path-then-last-basename policy. Ambiguous drive-relative paths have no guessed working-directory identity. Foreign absolute drive/UNC identities remain absolute; native Windows behavior is not certified by lexical tests on Linux.
- Field/playlist freshness binds the matched canonical destination path and observed Engine row identity in addition to values/revision. A replacement row or changed fallback candidate requires a new plan even if displayed field values are equal. Configured playlist DB aliases resolve before observation, matching the pinned writer root.
- Corrected Rekordbox point-over-loop normalization and native cue synchronization run through the real field adapter. Authorized hot-cue reconciliation precedes selected Main cue in either request order. Full export retains its distinct clear/rewrite rules.
- Post-commit native failure retains DB-commit/native-file reason; field exceptions stay unknown. Partial DAT/EXT replacement is not pair-atomic. Same-value field review is not a native repair operation.
- Creation backups use the validated destination path. Export-disabled/app-open/backup/stale-context guards remain. Other processes/legacy endpoints are not globally transactionally excluded.
- Unsupported #430 fields remain disabled: tags/catalogue, scalar BPM, RB energy/title/artist export and RB Main-cue import. No missing analysis generation, encrypted-library/native app/player/USB compatibility claims.

## Verification and venue

- `tests/test_library_export_integration.py` exercises production readers/writers on migrated disposable Library, actual Engine/pyrekordbox schemas and generated DAT/EXT. No performance/tag stubs in these combined adapter cases.
- Covers missing-block → separate creation → stale-token rejection → replan/export → idempotent repeat on both targets; unavailable-audio partial receipts; both Main/hot orders; true loop-to-point conversion; source/native/path freshness; partial native replacement and pinned backup paths.
- Retain original #417/#422/#426/#430 regressions. Original DB-only ordering probe isolates native synchronization explicitly; combined native tests cover that added writer boundary. WAL lifecycle tests remain read-only.
- #442 identity correction retains original reviewer duplicate-basename regressions and adds absolute/relative/mixed/separator/dot, fallback/canonical-duplicate, CWD/DB-alias, row-identity freshness and drive/UNC controls. Full Library fixture has two different `same.flac` files with Engine keys1/7; checker verifies the displayed first-row1, explicit consent and persisted first-row7 while second stays7.
- Full frontend/type/build checks, targeted backend, touched lint and one Alembic head are required. Broader backend baseline is not implied clean by focused passes. Exact results belong in the issue receipt.
- Review build uses the full production Library component, production routes/adapters and generated external DB/native files. It is not the old scope-table harness or simulated external success API.
- Build from `frontend`: `npm exec vite -- build --config scripts/review-library442/vite.config.ts --outDir <own isolated assets>`.
- Serve: `uv run scripts/agent/review_library_export.py --port <free port> --assets <own isolated assets> --pin <frozen pin>`; binds 127.0.0.1 and creates a fresh disposable root under `/tmp/opencode`.
- The server redirects host/library discovery to generated fixtures, uses unencrypted external SQLite and leaves real writer backup/closed-app functions in place. It does not start production background workers/device services. Playback/unrelated mutations are outside this review.
- `/source.json` names the pin and boundary. `/fixture/evidence` reads actual fixture DB/native contents and backup locations. The fixture gate/native-file controls accept no caller paths.
- `uv run scripts/agent/check_library_export.py --url <own fixture URL>` refuses other servers and mutates generated fixtures only. Use fresh fixture roots for repeat runs. Reviewer assets/processes must remain separate from author venues.

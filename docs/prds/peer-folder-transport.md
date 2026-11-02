# Opt-in local-folder Session transport

- Issue: #450, native child of #427, blocked by #441 for landing. Coda task72 explicitly assigns implementation now in the same production slot alongside #443.
- Base: frozen #441 currency correction `d3cc451c5985b4150d1132e9003493afa20653ec`, descendant of `1b7bbbdd6374734fe2de8a10f7ae74a006809db0` and `a13ea526c94234a07e8d62b5de131a9a53b7be7f`; all preserved for QA.
- Port: now for desktop transport feeding the existing guarded paired-device peer reader; native folder watching never (Android consumes #443 paired adapter). No Kotlin or phone installation here.
- Not full Library sync. No DB/WAL/backup replication, automatic audio export, deletion merge, friend authority, network listener, persistent OS daemon, real share configuration or private transfer.

## Operator contract

- Disabled by default. Local-owner-only configure/enable/disable/select/status routes under `/api/peer-sync/transport`; no Device/friend mutation admission.
- Configuration names an explicit app-owned exchange directory. Examples use `<operator-configured-exchange-directory>`, never actual machine roots. Verification uses newly generated temporary directories only.
- Enable requires an existing empty directory or a valid versioned app ownership marker. Do not adopt a populated arbitrary folder, follow symlinks, initialize a missing/offline mounted target or fall back to the current directory. No path can come from imported JSON.
- Explicit Session selection freezes the existing issued outbox through `PeerSync.export` with `reference_basis=explicit-current-row-bindings` and selected asset fingerprints. Only closed source Sessions with preselected/identified references qualify. Receiving/forwarding a peer projection never becomes a local outbox selection.
- Source namespace acceptance and receiver Track binding stay explicit existing #441 operations. A folder artifact never creates either. Complete-but-unbound or media-unavailable Sessions remain pending evidence, not normal history.
- Status distinguishes disabled, unconfigured, offline/unavailable root, pending/partial artifact, unknown source, immutable conflict, published/waiting ack, acknowledged, published file missing, bindings unresolved and media unavailable. Errors in one artifact do not strand unrelated selected Sessions.

## Storage and transaction seam

- Migration `0050_rxxlw`, parent `0049_nllos` (candidate currency correction): local singleton configuration, explicit outbox selections/publication cursor and durable inbound/ack receipts. No #441 wire/evidence contract changes.
- `FolderTransport(session_factory).run_once()` is the bounded production seam; returns/persists progress independently of the background scheduler. Each import/materialize uses a fresh transaction as required by `PeerSync._lock`.
- In-process polling worker starts with app lifetime, stops/joins on shutdown, and reads disabled config without touching the filesystem. No import-time thread or whole Library scan. Selected Sessions only; never auto-export every closed Session.
- Persist cursor/receipts before reporting success. Exact retries are no-ops. A DB rollback or process crash after a file publication can recover by checking its immutable content rather than rewriting it.

## Artifact protocol

- One versioned app-owned tree, source-replica/Session UUID/manifest-digest addressed. Manifest uses existing #441 `Manifest`; chunks use existing validated event JSON and declared SHA256 JCS digests.
- Publish bounded manifest/chunk files to same-directory temporary files, flush/fsync, then atomically hard-link to the final name without replacing an existing entry; fsync the directory. This uses no-replace publication rather than overwriting rename. Publish a small versioned complete marker last; it identifies Session/source/manifest digest and expected chunk hashes/count. No staging file is importable evidence.
- Import requires valid strict names, version, matching namespace and complete marker; content bounds and all digests are checked before considering the artifact complete. Resolve no path from payloads. Reject symlinked roots/components/files, oversized entries and path traversal; bound directories/files processed per tick.
- Reuse `Bundle` validation and `PeerSync.receive`; no alternate event grammar or mutable merge logic. Distinct chunks may arrive in any order; interrupted copy remains pending, never partial normal history. Conflicting evidence remains retained by #441 and transport records the error, not an overwrite.
- Unknown namespaces remain pending/quarantined in status; do not auto-accept or execute their payloads. Quarantine is metadata/status, not destructive moving/deleting someone else's files.
- Receiver publishes an immutable ack only after durable complete inbox receipt, not after assuming media readiness. Ack identifies receiver/source/Session/manifest digest; never carries local Track IDs. Only explicitly accepted receiver namespaces count as remote acknowledgments.
- Stable outbox cursor prevents re-emission and receipt cursor prevents import echo. Never emit a received Session as one's own. If a published artifact disappears, report file-missing instead of silently republishing/deleting personal state. Do not prune artifacts or merge deletions.
- Normal history materializes only when #441 proves complete immutable evidence, current explicit bindings and known exact local assets. Keep this distinct from delivery acknowledgment. Generation-bound normal/paired readers continue to reject stale/offline replay.

## Bounded file plan

- `backend/peer_sync/folder.py`: configuration, safe filesystem protocol, one-cycle coordinator and durable progress.
- `backend/peer_sync/models.py`, one migration: local transport state only.
- `backend/peer_sync/contracts.py` / `router.py`: strict local configuration/selection/status APIs.
- `backend/peer_sync/folder_worker.py` (if needed) and app startup/shutdown: in-process scheduling only; do not import `backend.main` in fixture tests (it migrates/backs up its configured DB).
- `tests/test_peer_folder_transport.py`: independent migrated DB/root fixture integration and decoy failure cases. Extend production Chromium harness for folder→normal Session replay, without fake APIs/audio.
- No shared nav/Engine export/Android source changes. Reuse existing normal Sessions UI and paired adapter. A later settings UI must not masquerade as an implemented transport dependency.

## Verification / Walkthrough

1. Configure A/B with disposable app-owned exchange directories and explicit reciprocal source namespace acceptance. Disable one and verify zero filesystem writes.
2. Select a generated closed A Session with source Track1; B has intended Track9 and unrelated colliding Track1. Start the in-process worker or call the same production cycle. Publish to A's directory, partially copy to B and verify pending/partial status with no normal Session.
3. Complete the copy; B durably receives and acks. No binding or missing/unknown/different bytes still forbids materialization. Explicitly bind B9 and supply only pre-existing generated exact local WAV bytes; the normal guarded materialization becomes usable.
4. Restart both DB/worker objects; repeat cycles/copies. Assert stable artifact bytes/mtime/cursor/ack, no echo/re-emission, correct conflict/unknown/file-missing states, unchanged phone v1 and unrelated curated state.
5. Drive the actual normal Session replay source/driver/DeckEngine/Mixer/worklet in Chromium from receiver9 after folder delivery/restart. Assert real signal/clock advance; remove only a decoy WAV and assert cached-ready resume refusal. Temporary processes stop with the test.

Additional decoy tests: missing/offline target, symlink/path traversal, invalid ownership marker/version, oversized files, digest mismatch, crash between file and cursor/ack, duplicate complete markers, per-artifact isolation, worker shutdown/disable, stale binding/ID reincarnation and unknown source after restart.

## Remaining priority order

1. Mutable curated metadata reconciliation: not in this issue; parent #427 still tracks full Library scope.
2. Playlist/Set reconciliation: not implied by Session transport; requires its own identity/conflict design and issue.
3. Separately authorized media transport: never auto-export private audio in this slice. Artifact delivery is not asset readiness.
4. Capture-time historical identity stamping and deliberate conflict resolution remain #441 limitations; legacy outboxes attest selected current bindings only.

Freeze a concrete implemented vertical slice with exact source pin, API walkthrough and independent QA. No live target/DB/device rollout without the project review gate.

## Implemented protocol and API walkthrough

- Root marker: `.manadj-peer-folder.json`, exact `{format: "manadj-peer-folder", version: 1, token: <32 hex characters>}`. Existing configuration pins the token and root; root rollover is not implemented.
- Requires a POSIX filesystem supporting no-follow directory descriptors, hard links and fsync. Unsupported filesystems fail closed; no fallback publication mode is supplied.
- Artifact directory: `<origin-UUID>_<Session-UUID>_<manifest-SHA256>` with canonical lowercase UUIDs/digest. Files: `manifest.json`, `<seq>-<event-SHA256>.json`, `complete.json`, `ack-<receiver-UUID>.json`. Marker/acks contain no paths or local receiver IDs.
- Limits: 256 root entries including the ownership marker, 255 selected publications, 256 accepted sources per cycle, 8 artifacts per tick with a durable round-robin cursor. Manifest: 1 MiB; complete marker: 512 KiB; ack: 2 KiB; aggregate chunk JSON: 3 MiB; at most 4096 chunks. No automatic pruning or folder rollover.
- Every absolute root component and artifact/file is opened with no-follow descriptor-relative operations. Regular-file/size/duplicate-key checks precede strict Manifest/Chunk/Bundle validation and digest checks. Unknown namespaces are recorded without opening artifact payloads.
- Polling starts/stops with backend lifetime (5-second interval). Publication/receipt/readiness status remains separate. Exact retries preserve file bytes and mtime; missing published files are reported, not recreated. Receipt acks attest accepted namespace claims, not cryptographic sender authentication or media readiness.

Local-owner API sequence (all bodies are JSON):

1. Initialize each replica: `POST /api/peer-sync/identity {}`. Accept the other replica explicitly: `POST /api/peer-sync/sources {"replica_id":"<other UUID>","label":"Own other machine"}`.
2. Configure each existing empty exchange directory: `POST /api/peer-sync/transport {"root":"<operator-configured-exchange-directory>","enabled":true}`. An external operator-owned folder copier may transfer artifact directories; this feature does not configure one.
3. Select/identify each source Track through the existing #441 local Track APIs, then freeze a closed Session: `POST /api/peer-sync/transport/selections/<Session UUID> {}`. No other local Session is automatically selected.
4. Inspect `GET /api/peer-sync/transport`. The lifetime worker publishes/receives automatically. Complete receipt may be acknowledged while `readiness` remains `unresolved_references` or `assets_unavailable`.
5. Explicitly select/bind receiver Tracks through #441's existing local APIs. Once exact pre-existing assets are available, the next cycle guardedly materializes normal history. Read/replay it through normal Sessions or the existing guarded paired-device adapter.
6. Disable without opening the configured folder: `POST /api/peer-sync/transport {"root":"<same configured directory>","enabled":false}`. An already-running cycle may finish; subsequent cycles perform no filesystem operations.

Automated walkthrough: `uv run pytest tests/test_peer_folder_transport.py -q`; actual Chromium/WebAudio: `uv run --with playwright --with pytest -m pytest tests/test_peer_replay_browser.py -q -rs`. Fixtures create independent migrated databases and generated audio only; servers stop with the browser test. No settings UI is claimed.

# Exchange Settings, health and safe root rotation

- Issue: #451, native child of #450 (transitive #427), depends on #450. Assigned now by Coda task91 in the same owning production slot; no extra contributor.
- Base: reviewed #450 `8b45ceeac7dc72fd9422786ea50c38e9c1a0ae64` plus SOURCE CLEAN strict generation descendant `104ba3f1d25e54312d4fdcffa44572c3040a12d9`; reviewed #441 `d3cc451c5985b4150d1132e9003493afa20653ec`. Preserve all pins.
- Port: desktop folder setup/rotation now; native folder watching/configuration never (Android uses #443 paired desktop adapter). No Kotlin or paired-wire fork.
- Not authorized: real roots/share configuration, Syncthing writes, private data/media transfer, device installation, rollout, landing, filesystem pruning or evidence/media deletion.

## UI/API contract

- Real Settings setup/health in `frontend/src/settings/SettingsPage.tsx`, typed methods in the existing API client and an isolated exchange settings component. All operations call actual local-owner APIs, not fake status.
- Explicit existing-root opt-in, accepted replica namespaces and receiver Track bindings; enable/disable; delivery progress/last success; partial/retry/conflict/file-missing/media-unavailable/unsupported states. Keep acknowledgment separate from normal-history/media readiness.
- Keep the local-control boundary. A Personal LAN generated demo is read-only for mutations; do not strip Origin/auth checks or authorize arbitrary LAN roots. Verify actual setup mutations from local Chromium against independent generated fixture DBs. Actual host-folder selection stays behind later explicit review.
- Health must disclose root capacity, archived pending/unacknowledged work, unavailable assets and platform limits; a root at its bound is actionable, not a permanent global selection stall.

## Root lifecycle and retention decision

- Bound active-root files/scanning and publication selections per root, not lifetime issued Sessions. Existing immutable SyncSession/SyncChunk evidence remains global/durable; do not rewrite wire artifacts or echo received projections.
- Archive means stop scanning/publishing a root while retaining every file, unacknowledged outbox, receipt and audit state. No pruning is implemented or implied. Surface disk/capacity limits explicitly.
- Rotation requires disable plus explicit authorization of another existing empty/owned root. Persist root identity/token, per-root selection/publication/receipt/cursor state and active configuration generation; late old-root completion/error/cursor publication cannot mutate the new active generation.
- Show pending/unacknowledged counts before archive; require explicit archive consent. Archived work stays visible. Explicit reactivation of a previously authorized, still-owned root must retry its original immutable outbox without silently accepting a changed mount/token.
- A new root receives only explicitly selected new outboxes. No automatic whole-history re-export or silent republish of missing old files. Explicit re-selection of previously issued evidence must retain the same manifest/chunks and root-scoped publication provenance.
- Archive/rotation is not a Session/Library deletion merge. Later pruning requires its own safe acknowledged-artifact/durable-deduplication contract and authorization.

## File/transaction plan before code

- Add root-scoped local transport models/migration; preserve the single Alembic head and existing #450 immutable artifact protocol.
- Isolate root lifecycle operations from `FolderTransport.run_once`; reuse its safe descriptor-relative IO and existing PeerSync receive/materialize. Keep one app-owned worker, no new daemon/listener.
- Extend strict local contracts/router/status with root health, lifecycle operations and durable progress timestamps. Every configuration transition is serialized and generation-fenced.
- Add frontend exchange Settings + typed API methods without shared navigation/Engine export changes. Reuse normal Sessions playback and paired reader.
- Add backend root lifecycle/retention/restart/security tests and actual UI browser fixtures. Do not import backend.main in fixture tests; use independently migrated generated DBs.

## Acceptance / walkthrough

1. Two independent generated libraries and directories. Configure/accept/select/bind through the actual Settings UI/API, not mocked fetch. Verify before/after states and local-owner/remote-preview boundaries.
2. Deliver partial files, retry and restart. Acks/health persist; unresolved or missing/changed assets forbid normal readiness. Explicit binding plus exact pre-existing generated WAV enables guarded normal history.
3. Fill an active root to its bound, archive/rotate to a fresh generated root and deliver another explicitly selected Session without deleting or automatically re-exporting old evidence. Reactivate the old root and retry pending work.
4. Exercise ownership/symlink/unknown-source/disable/unsupported and generation races, including disable→reenable and root replacement. Keep native Windows execution unclaimed unless actually run.
5. Drive actual normal Session replay source/driver/DeckEngine/Mixer/worklet after folder receipt and receiver restart; prove signal/clock and unavailable/replaced-byte refusal. Build/typecheck and relevant parent regressions.
6. Leave a generated-only full-app Personal LAN walkthrough/source build. Label HTTP visual/health review separately from secure-context WebAudio proof; manual real-host folder selection/rollout remains unapproved.

Full Library sync remains incomplete: mutable curated metadata, playlists/Sets and separately authorized media transport are outside #451. Historical capture identity/conflict resolution limitations remain.

## Implemented contract

- Migration `0052_ptmxq` retains legacy configuration/outboxes/receipts, adds authorized roots and composite root-scoped publication/receipt keys. Pre-configuration legacy selections are retained under an archived, unassigned root, never auto-exported. Multi-root downgrade refuses provenance loss.
- `POST /api/peer-sync/transport` explicitly authorizes/reactivates a root. Rotation requires the current root disabled and archived. Known roots must retain their original marker token; aliases cannot reuse another authorized path's token.
- `POST /api/peer-sync/transport/archive` requires `{generation, pending, retain_all_files: true}`. Stale generation/count consent fails. No archive operation touches the filesystem.
- `GET /api/peer-sync/transport/roots/{id}` inspects retained evidence without opening the root. Status exposes root limits, pending counts, successful-scan time and accepted namespaces. Scan success does not imply delivery or media readiness.
- Cursor, root-health, publication and receipt updates are serialized/generation-fenced. Already-running artifact IO may finish on its original descriptor; it cannot publish state into a new configuration. A selection racing rotation must be explicitly retried.
- Settings uses the existing API client/local-control routes. Initialization, namespace acceptance, Session selection, dependency inspection and guarded local Track binding are real operations. Remote previews disable mutation controls; the LAN review proxy additionally denies non-GET requests.

## Verification and Walkthrough

- Backend transport/lifecycle tests cover 255 selected Sessions plus marker (256 entries), rotation, explicit re-selection with identical wire bytes, archive consent, reactivation, retained-root inspection, restart, ownership/security and stale-generation races.
- Actual Chromium full-app Settings configures two independent migrated fixture libraries, accepts namespaces, selects a Session, observes a partial transfer, restarts the receiver listener/engine, binds Track 9, receives/acks and materializes normal history. The same received Session runs through the production replay source/driver/DeckEngine/Mixer/worklet with signal/clock; missing generated media refuses cached resume.
- Full frontend: 4,125 passed / 1 skipped; TypeScript/build passed. The added Help context was caught and fixed by the first full run.
- Actual HTTP LAN render exposed an existing startup crash: insecure contexts omit `navigator.mediaDevices`, but the device-change subscriber unconditionally used it. Device enumeration now reports no available outputs and subscribes to nothing when unavailable; secure audio capabilities are not fabricated. Two public-seam regressions cover this guard and subscription cleanup. Secure-context replay proof remains separate.
- Relevant backend/browser regression run: 144 passed, including migration roundtrip/lossy-downgrade refusal, selection-racing-rotation and actual full-app/replay tests. Ruff and the single `0052_ptmxq` head passed.
- Full backend attempt: 1,024 passed / 9 skipped; stopped at five failures (three feedback lane-path fixtures, two playlist-export lane guards). All five reproduce on unchanged parent `104ba3f`; no full-backend-green claim.
- No native Windows execution or real-host-folder/Syncthing/device rollout proof. Existing npm audit reports 19 vulnerabilities; no dependency updates.

1. Open the generated full app at `https://excalibur.tail67a291.ts.net:45757/?settings=1&section=session-exchange` or USER LAN `http://192.168.1.235:45757/?settings=1&section=session-exchange`.
2. Inspect Session exchange health: active receiver, acknowledged receipt and separate materialized readiness. Inspect the archived root's retained pending outbox; it is not scanned.
3. Inspect `/api/demo/status` for the exact source revision and generated-only source/receiver mapping (source Track 1 → receiver Track 9, unrelated receiver Track 1).
4. Open normal Sessions history for the received UUID. HTTP LAN is visual/health review, not secure-context WebAudio proof; the automated Chromium replay checks above provide that proof. Local-root mutations were tested through local Chromium, not enabled remotely.

Preview uses fixture routers and the full production frontend, not `backend.main`; unrelated host-config/device listeners are deliberately absent. Logs/stop commands live in the lane handoff. Review/landing remain unapproved.

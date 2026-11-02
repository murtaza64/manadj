# Durable peer Session exchange — first checkpoint

- Issue: #441, child of #427; parent #440 inventory pin624cb preserved and corrected by a82b20be. Coda task57 authorizes implementing this child before parent review/landing.
- Scope: actual immutable Session outbox/inbox, persistent replica/logical Track bindings, partial/retry/conflict storage and resolved event projection. **Not yet normal Session-history insertion, replay/mining integration, background synchronization or full library sync.**
- Port: now for existing Android snapshot/journal/pairing preservation and SessionDetail-shaped projection; later (#443) for native peer intake/presentation after guarded history integration. No Kotlin/device/install changes in this checkpoint.

## Identity and admission

- Local-only `/api/peer-sync` routes reuse the local-control boundary, not friend authority, phone pairing codes or device tokens. No listener, transport client, watcher, shared folder or discovery service is introduced.
- `POST identity {}` explicitly initializes a persistent replica UUID; retries return the same UUID. `GET identity` never initializes. Database restoration preserves this namespace; cloning it is not creation of a different replica.
- `POST sources {replica_id, label}` explicitly accepts an own-source namespace claim for manual imports. It is **not cryptographic device authentication**. Use only deliberate local-owner artifact import over an owner-controlled channel; do not expose these mutators as an automatic LAN bridge.
- Namespace/recording labels are display claims, not accounts or permission grants. Source namespaces cannot accept themselves. Importing an artifact cannot auto-accept its source.

## Stable Track bindings

- `POST tracks/{local_id}/select {}` records a local-only random row-selection token and returns a guard. `GET tracks/{local_id}` is read-only and reports an existing guard or null.
- `POST tracks/{local_id}/identify {guard}` assigns a logical UUID to that explicitly selected row, or returns its existing UUID. `POST tracks/{local_id}/bind {guard, logical_track_id}` deliberately binds an imported logical UUID to a current local row.
- Logical identity is not byte hash, local integer, filename, metadata or phone audio_rev. Equal selected bytes may belong to distinct logical Tracks; no candidate hints from #440 perform bindings.
- Binding conflicts reject409, preserving both records; no guessed alias union. Track IDs are never renumbered. On Track deletion the logical binding becomes unbound while the selection token is deleted by FK CASCADE. Reused integers/path/timestamps cannot reuse an old guard or inherit a binding. Explicit fresh selection may rebind an orphaned logical UUID.
- Filename relocation invalidates stale guards without changing logical identity. Source export requires pre-identified selected references; it never mints identities by looking at metadata/hash candidates.

## Artifact / immutable storage

- `POST sessions/{uuid}/export {reference_basis: "explicit-current-row-bindings", fingerprint_assets?: bool, seqs?: [integer]}` freezes one selected **closed** existing Session in its issued outbox on first export. Later exports read that frozen copy, not a silently refreshed recording/file version.
- Explicit reference basis matters for legacy logs: old capture events contain only source-local IDs. The exporter attests selected current bindings; it does not recover a provable capture-time identity for a previously deleted/reused source row. New capture/history integration must address this remaining limitation.
- Bundle requires `format: "manadj-peer-session"`, integer version1 and `digest_algorithm: "sha256-rfc8785-jcs-v1"`; manifest requires Session UUID, source replica UUID, `capture-events-v1` grammar, reference basis, recording origin, closed UTC RFC3339 times, logical reference declarations and ordered chunk hashes.
- Existing capture-event vocabulary is preserved, including A–D loads/control/transport/scratch/loops, ticks, tenure, Beat FX/settings and role-pair init snapshots. Unsupported kinds/fields or malformed Track-reference sites reject rather than strip. Only load.trackId and init.decks.A/B.trackId are remapped.
- Manifest/chunk integrity uses maintained `rfc8785` JCS plus SHA256, not an ad-hoc float serializer or authentication claim. JSON integer-valued-float normalization remains interoperable. Bundles emit no media bytes, credential fields or machine-local root/filename descriptors; recording-origin/tenure strings remain source-authored data.
- Limits:4MiB request,3MiB export response,4096 declared chunks,5000 events per chunk,128 referenced Tracks, bounded JSON depth/text/collections. Select fewer sequences when a response exceeds its budget. Local freezing reads the selected recording; no whole-Library media scan.
- `POST imports <bundle>` persists immutable received headers/chunks transactionally. Partial arrival is durable; exact retries are no-ops, disjoint chunk sequences union, distinct Session UUIDs union. Chunk content must match its declared digest, source references must be declared, final sequences must be complete/contiguous, event times ordered and the completed stream audible under the existing Session audibility helper.
- Same UUID with differing header/chunk evidence conflicts409; original and incoming snapshots are retained once per incoming payload digest. A collision with existing normal local history also preserves the actual local header/events, not a fabricated manifest hash. No wall-clock winner or overwrite.
- `GET sessions` lists received inbox records; `GET sessions/{uuid}/conflicts` returns bounded durable conflict metadata. Conflict resolution/curated merging is not implemented.

## Resolution / file availability

- `GET sessions/{uuid}` re-resolves logical references through persistent current bindings; it never falls back to the remote integer. Partial/unbound records have no SessionDetail projection. Fully bound records expose the existing SessionDetail event shape with current receiver IDs and retain source namespace/recording origin separately.
- Optional fingerprinting hashes only explicitly selected source files. Tagged SHA256/length describe the selected export-time byte version, not the logical Track or forensic proof of the historical recording's original bytes. First-export descriptors remain immutable.
- Dependencies report unbound/missing/partial/changed/unverified/exact. A path/hash hint never binds a record. A shorter arriving file is partial; changed same-size bytes fail exact; no descriptor stays unverified. File reads are only bound DB paths, never an imported path/URL. Rehash selected bytes and check file identity/stat stability; no mtime-only cache trust.
- `dependencies_ready` means the declared byte versions are present at the bound rows, **not decoder/playback readiness**. Capabilities: session_exchange true; library_apply/playback/audio_transfer/curated_merge false. No media transfer, download, Take fabrication or personal Transition/Link change occurs.

## Schema / compatibility / next work

- Migration0047_uxoxz adds seven isolated peer-sync tables: local namespace, accepted namespaces, logical Track bindings, local row selections, immutable issued/received Session headers, chunks and conflict snapshots. Parent0046_yumpp; no existing Track ID/phone journal column changes.
- Existing Android snapshot version1, integer references, Session push/read DTOs, pairing and ADR0045 old/new edit/journal/revert semantics remain unchanged. This does not claim cryptographic peer authentication or desktop-peer mutable-field reconciliation.
- Next within #441: guard every normal Session-history/replay/miner/export consumer against binding loss/ID reuse before materialization; stamp/retain capture-time logical references; deliberate conflict resolution and own-device transport/Android adapters. Do not treat this inbox as an already-integrated Library sync UI.
- Syncthing remains a proposed carrier of suitable immutable artifacts/media, not live SQLite/WAL/backup database replication. No topology, shares, credentials, services or real libraries changed.

## Verification

- `uv run pytest tests/test_peer_session_exchange.py tests/test_peer_inventory.py tests/test_device_sync.py tests/test_device_edits.py tests/test_device_listener.py tests/test_sessions_router.py tests/test_session_audibility.py -q`.
- Independent migrated disposable DBs, production APIs, explicit selection/identify/bind, ID collision/reuse, equal bytes/different logical IDs, partial arrivals, namespace admission, stable outbox, conflict snapshots, JSON normalization, file version states, idempotent/concurrent retries and a genuinely fresh Python-process restart.
- Existing phone snapshot before/after exchange is unchanged; resolved output validates against SessionDetail. Partial/unresolved/conflicting exchange creates no normal Session/Take/Transition/Link rows. No normal-history/app/browser sync proof is claimed.

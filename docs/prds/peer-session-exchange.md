# Durable peer Session exchange

- Issue: #441, child of #427; parent #440 inventory pin624cb preserved and corrected by a82b20be. Coda task57 authorizes implementing this child before parent review/landing.
- Scope: immutable Session outbox/inbox, explicit Track bindings, guarded normal history, replay/mining/clip readers and paired-device read adapter. **Not background synchronization or full Library sync.**
- Port: now for paired-device version1 peer reader and existing Android snapshot/journal/pairing preservation; native intake/presentation in #443. No Kotlin/device/install changes in #441.

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
- Remaining: capture-time logical reference stamping, conflict resolution, automatic own-device transport and native #443. Legacy export still explicitly attests current selected rows, not recovered historical incarnations. Curated metadata, playlists, Sets, Takes and saved Routines are not exchanged.
- Syncthing remains a proposed carrier of suitable immutable artifacts/media, not live SQLite/WAL/backup database replication. No topology, shares, credentials, services or real libraries changed.

## Verification

- `uv run pytest tests/test_peer_session_exchange.py tests/test_peer_inventory.py tests/test_device_sync.py tests/test_device_edits.py tests/test_device_listener.py tests/test_sessions_router.py tests/test_session_audibility.py -q`.
- Independent migrated disposable DBs, production APIs, explicit selection/identify/bind, ID collision/reuse, equal bytes/different logical IDs, partial arrivals, namespace admission, stable outbox, conflict snapshots, JSON normalization, file version states, idempotent/concurrent retries and a genuinely fresh Python-process restart.
- Existing phone snapshot before/after exchange is unchanged; unresolved/partial/conflicting imports create no normal personal rows. Normal history requires the separate explicit materialization below.

## Guarded normal history — task61

- Migration `0048_qsuqz`, parent `0047_uxoxz`: `peer_history(session_id FK sessions.id ON DELETE CASCADE, source_sha256, binding_sha256)`.
- `POST /api/peer-sync/sessions/{uuid}/materialize {}` is local-owner-only. Requires complete audible immutable source, current explicit selections/bindings and exact declared assets. Returns `{session_uuid, duplicate, binding_generation}`; unresolved/missing/partial/changed/unverified sources reject409 atomically.
- Creates only a normal Session header and projection marker, never compiled integer-ID SessionChunks. The immutable peer store remains canonical. Source digest and logical-UUID→local-ID/selection-token/path fingerprint guard every read.
- Normal Session list includes the header. Normal detail returns remapped events plus nullable `replay_generation` (digest of source and binding fingerprints). Missing assets, lost bindings or changed incarnations reject409 without deleting metadata/evidence. Recovery never sweeps a peer header as empty/silent.
- Exact import/materialize retries remain idempotent after materialization. Normal append/end and phone push reject409 for peer-managed rows. Deleting a normal header removes its projection/candidates, not peer evidence.
- Explicit rematerialization after rebinding changes the generation, removes mined candidates and clears miner currency. New/rematerialized projections enqueue the normal Routine miner; exact retries do not enqueue again. Same ID/path/bytes after delete/reinsert is a new incarnation and cannot inherit ready status.
- Normal detail, miner, candidate reads, promotion preview and Session-span clip source use `session_source.session_events`. Candidate reads validate provenance even when stored cast/offset rows are cached. Saved Take/RoutineTake derivations reject409 for peer-managed sources; the Mix editor refuses peer drafts rather than loading bare-ID audio.
- Desktop replay fetches fresh normal detail, validates generation/assets before start/resume/seek and every load, and obtains bytes from `GET /api/sessions/{uuid}/audio/{receiverTrackId}?generation=...`. The endpoint verifies membership/generation and the returned byte snapshot's exact SHA256/length; it never reopens a checked mutable path via FileResponse. Responses are `no-store`.
- Peer DeckEngine loads bypass both bare-ID decode/stem caches and do not populate them. Clip preview responses carry `peer_source: {session_uuid, generation}`; clip rendering revalidates it, including render-cache hits, and fetches the same guarded bytes. No stems substitution.
- Byte availability remains distinct from decoder support. Invalid codecs can pass byte readiness but fail decoding. Actual generated-WAV replay is covered by the Chromium test; capability flags remain conservative, not a declaration of full cross-device playback support.
- Huge JSON integers in numeric/time/reference paths reject422 before float conversion; no `math.isfinite(int)` overflow500.

## Paired-device peer reader — version1

Uses the existing Device listener token/pair-code boundary, never local-owner mutators or friend authority. Legacy `/api/device-sync/sessions/{uuid}` refuses peer-managed rows409; old snapshot/journal/local Sessions are unchanged.

- `GET /api/device-sync/peer-sessions` → `{version: 1, items: [item]}`. An unused/uninitialized peer store returns an empty list.
- `item`: `session_uuid`, `origin_replica_id`, `recording_origin`, `manifest_sha256`, `started_at`, `ended_at`, `materialized`, `state`, `replay_generation`, `dependencies`, `conflict_count`.
- States: `partial_chunks`, `unresolved_references`, `assets_unavailable`, `not_materialized`, `stale_binding`, `ready`, `source_invalid`. Only `ready` advertises a non-null generation. Invalid stored evidence can have null timestamps. Rejected conflict receipts increment `conflict_count`; they never overwrite/disqualify the selected original.
- Each dependency: `{logical_track_id, local_track_id, asset_state, sha256, byte_length}`. Unbound local IDs and unknown version descriptors are null. Asset states remain `unbound`, `missing`, `partial`, `changed`, `unverified`, `exact`.
- `GET /api/device-sync/peer-sessions/{uuid}?generation=...` → `{version: 1, item, session: SessionDetail, tracks: [...]}`. Each track: `{local_track_id, logical_track_id, sha256, byte_length, track: {id,title,artist,bpm,duration_secs,main_cue,hot_cues,grid,audio_rev}}`. Cue/grid shapes match the snapshot. Fresh selected-row facts replace stale phone snapshot facts; `audio_rev` is informational, not byte-version authority.
- `GET /api/device-sync/peer-sessions/{uuid}/audio/{receiverTrackId}?generation=...` → exact verified bytes, `Cache-Control: no-store`. No local path/foreign ID is accepted.
- Detail/audio:404 missing/not materialized;409 unavailable/stale generation/nonmember audio ID;422 invalid UUID/missing query;401 missing/revoked pairing authority. Native cannot initialize/accept/bind/materialize through this listener.
- Native must deduplicate normal/peer headers by UUID, retain provenance, fail closed on unknown versions/states, and validate at open/start/resume/seek/load. Cache evidence read-only; key audio by generation+digest and verify SHA256/length. Offline evidence is not offline replay authorization. #443 owns Kotlin and native verification; no phone install is implied.

## Local two-library walkthrough

Run against two owner-controlled loopback instances using disposable Libraries. Artifact transfer is deliberate file import, not discovery or background replication. Substitute actual selected closed Session/Track IDs; never infer a binding from equal integers or metadata.

1. On A and B: `POST /api/peer-sync/identity {}`. On B: `POST /sources {replica_id: <A identity>, label: "Own A"}`.
2. On A: `POST /tracks/<selected A ID>/select {}`, then `POST /tracks/<ID>/identify {guard: <returned guard>}` for every referenced Track.
3. On A: `POST /sessions/<UUID>/export {reference_basis: "explicit-current-row-bindings", fingerprint_assets: true}`. Save the returned JSON artifact; manually carry only this selected artifact to B.
4. On B: `POST /imports <artifact>`. For each declared logical UUID, select the intended receiver row and `POST /tracks/<B ID>/bind {guard, logical_track_id}`. GET peer detail must report `dependencies_ready: true`; select existing exact local audio, never copy a DB/WAL.
5. On B: `POST /sessions/<UUID>/materialize {}`. Open the existing Sessions UI: the imported header appears and replay uses receiver IDs. GET normal `/api/sessions/<UUID>` includes its generation; guarded audio requires that generation.
6. Repeat imports/materialize: `duplicate: true`. Restart B: history persists. Removing only a generated decoy file leaves its header but detail/replay returns409; restoring exact bytes restores availability. Deleting/reusing a row requires explicit new binding and rematerialization.

Automated reproduction, no real Library or phone:

```sh
uv run pytest tests/test_peer_history_integration.py tests/test_peer_device_adapter.py -q
uv run --with playwright --with pytest -m pytest tests/test_peer_replay_browser.py -q
```

The browser test uses independent migrated DBs, a restarted receiver, actual HTTP APIs and production replay source/driver/DeckEngine/Mixer/worklet. It asserts receiver Track9, real audio-clock advance and nonzero channel signal, then deletes a generated WAV and verifies cached-deck resume refusal. All temporary servers terminate with the test. It requires installed frontend dependencies and Playwright Chromium; a skip is not playback proof.

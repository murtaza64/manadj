# Native foreground group replica — #453

- Parent: #452. Port: now Android; desktop/backend counterpart #452.
- Contract baseline: backend `af88644f16f5bb8d41668c2ac7b1bcbc26d57a14`, `backend/peer_sync/group_contracts.py`; subsequent backend receiver-JCS requirement adopted. Wire fields unchanged.
- Entry points: `GroupReplica`, `GroupExchange`, `GroupHttpTransport`; additive `LibraryRepository.groupReplica()` / `syncGroup()`.
- No group UI, automatic enrollment/migration, phone listener or background scheduling. Existing installed behavior is unchanged until an explicit separately authorized configuration/update.

## Authority and persistence

- Local owner supplies stable group/device UUIDs and an Ed25519 seed, and pins each member public key out of band. No wire message imports members or changes trust.
- Pins are immutable; local irreversible revocation rejects that signer and relay, including forwarding stored revoked-origin operations. Revocation is not globally immediate; each offline replica must receive its own authorized local change.
- Use an app-private group directory under `LibraryStore.root/device-groups/<UUID>`; legacy pairing, snapshot, audio and edit journal are never retargeted or removed. Different groups retain separate stores.
- `replica.json` contains the private seed and ledger. Directory mode0700, state mode0600; file fsync, atomic replacement and directory fsync complete before acknowledgement returns. Backups contain credentials and require equivalent protection. No Android Keystore/hardware-backed key claim.
- Per-directory in-process mutex plus OS file lock serializes state transactions. Corrupt/missing state fails closed, never auto-resets. Ledger cap64MiB rejects new writes without deleting old evidence.

## Immutable evidence slice

- Signed bodies use UTF8 `manadj-device-group/v1` plus NUL, raw Ed25519 public32/seed32/signature64, standard padded base64. Tink supplies portable Ed25519 without requiring an Android26 platform Ed25519 provider.
- Issuers use RFC8785; receivers require canonical UTF8 JSON, strict envelope fields, bounded depth/length and pinned signatures. Operation max1MiB; other bodies/HTTP max4MiB. Relay preserves original bytes/signature, operation/Session/Track UUIDs and namespaced source references.
- Only complete `session-create`, `parents=[]` supported. Existing Bundle/chunk digests, complete contiguous chunks, declared Track references, event grammar and audible evidence are validated. Dense temporary IDs are used only inside validation's existing audibility reducer, never as receiving bindings or signed data.
- Same operation UUID with different bytes rejects. Same Session UUID in different valid operations retains both; no clock-order winner. Local retry returns its original operation rather than minting another.
- Durable acknowledgements bind peer, recipient, operation UUID and body SHA256; they prove metadata receipt only. They never imply assets, local Track binding or playable readiness.
- Authenticated Delivery/Page supplier-possession proofs are persisted separately from peer-signed acknowledgements, bound to the exact operation UUID/hash. Pending push and pull exclude a known supplying relay; no synthetic peer acknowledgement or origin rewrite is created. This corrects the supplying-relay echo found at frozen `49d3e3a9678373fa981594311af57597331d178c`.
- Native ledger has no automatic projection into received replay, local recording history or Library/audio caches. Portable TrackUUID/asset descriptors are retained; source integers are never attached to receiving rows. Audio transfer and guarded native projection remain outside this metadata-relay slice.
- Existing local-integer offline edits remain in the legacy journal. They are preserved, not relayed to another desktop as portable operations. Curated updates/deletes/causal merge are not implemented.

## Foreground exchange

1. Push original pending operations to the explicitly selected peer; verify/persist its signed ack.
2. Pull signed pages bound to peer, recipient and fresh request UUID. Store authenticated operations durably before sending their acks.
3. Advance only within that serving peer's scan. New scans start at zero; failures retain evidence and recover via duplicate delivery/pull. Bound page count and reject non-progressing pages.

HTTP redirects are refused; legacy pairing credentials are never sent. A bounded explicit URL routing prefix supports reverse proxies and generated integration fixtures; it does not supply authority. Reachability/TLS must be configured separately. No phone server, Syncthing share, hosted relay or real-device operation is implied.

## Automated walkthrough

From `android/`, with the local JDK17/SDK configured:

```sh
./gradlew :library:test --tests '*Group*Test' --rerun-tasks
```

1. Backend static signed ACK and RFC8032 vectors verify; native signing matches exact expected signatures. Mutated message/signature and malformed framing reject.
2. Three generated Kotlin replicas exercise A→phone→B and reverse with no A↔B transport. Reopened stores and a separate JVM process retain exact issuer bytes and per-peer acks; retries/scans do not echo.
3. Production repository foreground HTTP calls use generated loopback peers; peer/recipient/request/hash checks reject substitution. Unknown/revoked/forged members and UUID equivocation fail without trust changes.
4. Missing assets/reused foreign integers never become local bindings; group changes preserve generated legacy cache/journal/pairing sentinels and repository credentials. This proves preservation, not portable legacy-edit migration.

No manual/device check applies to this library-only checkpoint. Android DEX/compilation is build evidence, not installed lifecycle, scheduling, native audio or physical speaker proof. Cross-language Python↔Kotlin relay results must be recorded separately from the Kotlin-replica harness.

## Cross-language checkpoint

- Executed against backend correction `e72e57f763061b7f2474516fac655410ae9d0133`, generated Python A/B HTTP fixture; its Python-phone oracle was unused.
- Actual Kotlin foreground client: first A exchange0push/1pull; B exchange1push/1pull; reverse A exchange1push/0pull. Subsequent scans of both peers0push/0pull; a separate JVM process reopened native state.
- Both Python replicas and Kotlin persisted the same two original operation UUID/body-SHA256 pairs. No direct A↔B transport or native re-minting occurred. Raw issuer signatures survived native persistence/reopen unchanged.
- These are generated metadata-relay results, not installed-phone, asset transfer/readiness, native playback or transparent scheduling proof. Later backend validation changes require a separately pinned rerun, not reuse of this receipt as new-source evidence.

# Native Session-history projection — #455

- Parent: shared #454 under #452. Port: now Android; desktop counterpart #454.
- Shared view: `manadj-group-session-view/v1` from backend checkpoint `1a69132ccd85da83d48a8d397f26cfe7f97165a4`. Exact deny-reason tuples follow backend `ac9c1561e5c55f091629d2cdd3a6d9fe468e096f`.
- Shared generated fixtures: `tests/fixtures/group_session_v1.json` and `group_session_deny_v1.json`. The Session contains two portable Track references/fingerprints, two real capture chunks, six events and closed UTC timestamps. It is not a generic metadata stub.
- No group playback, audio transfer, automatic binding, enrollment, scheduler, old-journal merge or installed activation. Follow-up: #456 exact-asset resolution and guarded replay.

## Projection and normal history

- `GroupHistory` revalidates original signed operation bytes, UUID/hash identity, complete Bundle/chunk/event grammar and supplier proofs before producing a view. Invalid/generic evidence remains retained and cannot create a normal Session row.
- Projection is an explicit separate commit after metadata durability. A monotonic group/UUID authority index precedes the derived projection file; reads never repair or project. Missing derived rows remain pending; corrupt/missing known group storage fails closed without removing evidence or restoring raw fallback.
- Normal `SessionScreen` history uses group+operation row keys. Human primary labels show local-owner device names and supplying relays; UUIDs, hashes and asset descriptors require technical expansion. Relay attribution is an unordered supplier set, not an asserted route.
- Valid received rows are `projection-pending` until committed, then `unbound`: native explicit current Track bindings are not implemented. Revoked/conflicted override readiness; metadata and acknowledgement never enable Play or editing. Every view has `playable=false`, `editable=false`.
- Same-Session incompatible manifests and retained unrelated raw history are conflicts. Every original recording/cache file is retained. Missing/invalid evidence produces a warning, not a fake Session with invented data.
- Received UUIDs are also committed inside the metadata ledger before ack, independently of operation bookkeeping and derived rows. History reads inspect signed bodies and authenticated supplier proofs before filtering; proof coverage requires exact issuer bytes/identity/hash, not mere operation-index presence. Missing/contradictory proof or rows fail closed.
- Original local-issued operations alone do not take over their own recorded Session authority. Foreign received claims with the same UUID block ambiguous raw playback, including retained phone recordings.

## Authority across legacy paths

- Raw recorded, desktop-header/cache, summary, direct `open`/`show`, resume/seek, running replay, native load and legacy upload paths consult group/paired authority. New foreign claims stop an already open colliding replay; no foreign integer is reinterpreted through the current Library.
- `SessionStore` binds raw detail/summary reads to repository authority, including before returning a cached detail after network failure. Explicit peer/group headers cannot enter its raw reader.
- Existing paired adapter v1 may send `group_metadata_only` / `group_managed` deny markers to a phone with no group enrollment. They update the existing monotonic UUID fence, not trusted membership or a verified Session projection. Native hides them from normal Session rows and exposes an inspect-only status; a real local group view supersedes the marker.
- The paired refresh intent is fsynced before fetching/validating authority. A malformed v1 batch—including a valid denial followed by a bad UUID/nonobject—makes all in-memory authorities unknown and retains that intent across restart; it never cleans up to an old empty permission set. Valid batches establish all ordinary/group denials before any fallible cache write. Ordinary #443 denials and exact group reasons persist separately with fsync/atomic replacement. Unknown/historical reasons remain denials; recognized unsupported versions/offline/no-adapter responses preserve the prior authority contract.
- The only own-recording exception requires every paired reason to exactly match an already locally verified own-issued group/operation/origin/body-SHA tuple. Origin UUID alone, a changed hash/op/group, mixed origins, malformed/missing or more than256 reasons cannot exempt a source. An older ordinary peer denial is never overridden.
- This exception selects the actual retained phone recording, never a requested desktop/cache header. Direct `show` also compares its events with the original recording. It grants neither peer replay nor legacy raw-ID upload; local-issued group operations use the group transport instead. Leaving a group does not erase original recording authority.
- Opening group inspection closes any previous replay context; group evidence cannot inherit another Session's Play controls. Malformed local-store exception text is never displayed because platform JSON errors can include source text/signing material.
- Existing unrelated legacy recordings remain replayable. Pairing, cache/audio, current snapshot and offline edit journal are neither reset nor retargeted.

## Verification boundaries

- JVM tests cover strict full payload and typed views, idempotent projection, pending/storage failure, revocation, invalid/generic payloads, local collisions, missing group stores and own-source/deny reason controls.
- Real Compose tests use normal `SessionModel`/`SessionScreen`, a generated Library/recording/cache, and a host audio-output double. They check expandable evidence, all raw entry fences, active-replay closure, unchanged recordings/cache, unrelated legacy playback, paired status without enrollment and the exact own-source exception. PNGs are actual native host rasters, not phone screenshots.
- Opt-in `GroupHistoryPythonInteropTest` uses an isolated generated #455 phone store, actual Python A/B HTTP exchange and normal `/api/sessions` history, process restart, exact operation IDs/hashes, paired deny markers and retained raw decoy bytes. The earlier #453 sandbox is not reset/reused.
- The Compose integration case clones only that retained generated public-test-key ledger into a disposable read-only UI fixture; it renders the actual transported operations without fabricating issuer or supplier bytes. No transport/enrollment runs from the clone.
- Android compilation/DEX, host PCM doubles and screenshots do not prove installed lifecycle, Android filesystem/keystore behavior, MediaCodec/JNI/Oboe, physical audio or background reachability. No physical device action is authorized by this source slice.

## Automated walkthrough

1. Run `:library:test` with the explicitly started generated full-Session HTTP fixture; inspect normal Python histories and native unbound views, original IDs/hashes, restart and noecho receipts.
2. Run `:app:testDebugUnitTest --tests '*GroupSessionUiTest' --tests '*PeerSessionUiTest'` with an owned nonexistent snapshot and generated raster output directory.
3. In the raster review, inspect normal received rows, human evidence, expanded technical details, revoked/collision states, paired deny-only status and the actual transported two-Session history. No group Play control should appear.
4. Keep source/fixture, installed and device-proof states separate in the completion callback. Installation and exact-asset replay remain separate work.

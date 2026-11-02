# Native exact-local group replay — #456

- Port: now Android + desktop under shared #456. Contract: `backend/peer_sync/replay_contracts.py`, shared PRD `group-session-replay-456.md`, immutable fixture `tests/fixtures/group_replay_v1.json` introduced at `ea634e629669323421a045b1ed223771a05c982b`.
- Source scope only. No install/device/ADB, automatic binding, download/transfer, enrollment, scheduler, curated journal mutation or alternate engine.

## Interfaces

- `GroupBindings.select(localId)` captures explicit current cached-file selection: fresh UUID, persisted snapshot physical identity, canonical row digest and file dev/inode/ctime/mtime/size; exact SHA256/length. These facts stay local. Unsupported stable identity refuses. Snapshot/ID/audio revision alone never authorizes a binding.
- Every selection read recomputes incarnation from its lookup UUID and current snapshot/row/file facts. Editing a mutable stored fact cannot restore an unchanged old selection/generation after physical replacement or snapshot rewrite.
- `GroupReplay.bind(view, logicalUuid, selection)` durably commits an exact current selection against group/op/raw-body SHA. Missing/partial/changed/stale selections refuse; same bytes in a new file or an identical rewritten snapshot invalidate prior selection.
- `GroupReplica.load` validates retained seed-derived Ed25519 public key against the current local UUID's member pin before any read, own-source exemption or signing. Missing/mismatched local identity fails closed without changing evidence. Retained received-UUID inventory and signed supplier recipient identities separately prevent received evidence becoming an own-source exception.
- `GroupReplay.readiness/open/audio/validateLoad` are a separate GROUP adapter. Metadata `GroupSessionView/v1` remains nonplayable; candidate readiness is never a decoded grant. Existing raw/ordinary peer fences remain intact; unknown inventory, conflicting recordings, revoked authority and ordinary peer collisions refuse.
- `audio` materializes only already-verified local bytes in a private unique load-attempt file. It does not reopen an ordinary cache path for decode. No network audio path exists.
- `SessionModel` feeds mapped group evidence through existing `SessionLog`, `ReplayDriver` and `PlayerModel.load` / `AudioEngine`. Each decode proof binds unique attempt source, engine request generation and actual successful fully-decoded load ID. Post-async authority checks must finish before scheduling. Replaced/stale decoded loads cannot satisfy a current attempt.
- Play/seek/resume/open/load revalidate; scheduling checks current authority and physical incarnations. Stop/cancel safety commands remain available after revocation. Immutable metadata/evidence and unrelated phone recordings are retained.
- SessionScreen exposes explicit dependency selection, local cached-file choices, candidate status and guarded open; user Play remains the existing replay control. Unknown or unsupported event grammar refuses, rather than silently dropping effects/actions.

## Proof

- `GroupBindingsTest`: persisted restart, identical snapshot rewrite, same-byte replacement, changed/partial/missing audio, failed selection commit; generated decoys only.
- `GroupHistoryTest` local-device/seed/pin/missing-member corruption controls: refuse history authority, raw playback/upload, group readiness and signing; retain original state, then explicit generated-data restoration recovers. Seed/pin/history and changed-device signing controls were RED before the bounded load guard.
- `GroupReplayTest`: literal Python JCS generation vector, strict common grammar, exact signed two-Track WAV fixture, explicit remap, restart, unique verified-byte attempts and revocation/cache refusal.
- `GroupReplayPythonInteropTest`: opt-in actual Python A → Kotlin PHONE → initially empty Python B; signed delivery/pull/ack, reverse/retry/noecho, exact raw operation bytes, local native509/510 versus backend73/88, normal B history and separate local candidate generations. WAVs are generated locally, never fetched.
- `GroupSessionUiTest`: real SessionScreen/SessionModel selection → binding → guarded open → actual host-output-double decoded load/playing. Active revoke, same-byte replacement, stale engine load ID and binding-store failure stop/refuse; transported ledger clone exercises actual controls. Screenshots show paused actual guarded source, not installed phone/audio output.
- `GroupSessionNativeChainTest`: clone retained transported generated phone, reject copied physical bindings, explicitly select clone-local assets; existing native Engine + ReplayDriver initial/seek/resume. Independent literal event schedule compares184000 float samples and591 deck position checks; opt-in fixture/ASan+UBSan bridge, not Android decoder proof.
- Preserve first fresh-relay receipt separately from resumed proofs. Initial fresh relay reached A0/1 → B1/0 → reverseA0/0, but final history read failed because fixture lacked `/b/api/sessions`. Corrected same-data fixture rerun is a separate full PASS receipt; it does not relabel the partial first run.

## Commands / limits

- From `android/`: `:library:test :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin :app:mergeExtDexDebug` with JDK17/SDK35 and an owned nonexistent `manadj.snapshot`. Full fixture flags: `MANADJ_GROUP_FIXTURE_URL`, `MANADJ_GROUP_HISTORY_FIXTURE_URL`, `MANADJ_GROUP_REPLAY_FIXTURE_URL`, `MANADJ_GROUP_REPLAY_PHONE_DIR`, `MANADJ_NATIVE_REPLAY_BRIDGE`. Otherwise opt-in proofs skip explicitly.
- Native host bridge build: `clang++ -std=c++17 -O1 -Iandroid/audio-engine/src/main/cpp/third_party -fsanitize=address,undefined android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/PeerReplayBridge.cpp -o <owned-scratch>/native-replay`.
- Existing full-app `HypermeterTest.resetMarkSetsThePhase` fallback fixture failure remains separate from replay; old ordinary peer native chain requires its own HTTP fixture.
- Not proved: Android stable-file provider/MediaCodec/JNI/Oboe, installed lifecycle/keystore/filesystem, physical phone or speaker alignment. Unsupported Android file identity refuses rather than claiming host-JDK parity.

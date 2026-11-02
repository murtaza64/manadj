# Android resolved peer Sessions (#443)

- Port: now Android; desktop owning-boundary projection/paired adapter is #441. No new pairing, phone installation or local-owner mutation authority.
- Backend prerequisite: #441 guarded history plus the legacy Device Session-list exclusion correction. Paired `peer-sessions` v1 is the sole peer intake; ordinary snapshot/journal/Session v1 remains unchanged.
- Source namespace, original recording origin, immutable manifest and binding generation stay separate. Receiver IDs are usable only inside a freshly validated projection; paths/hashes/integer collisions never establish logical identity.

## Contract

- Existing own-phone pair/token headers authenticate every request.
- `GET /api/device-sync/peer-sessions`: `{version:1,items:[...]}` with state/provenance/dependencies/materialization/generation/conflict receipts.
- `GET /peer-sessions/{uuid}?generation=...`: ready projection, receiver Track metadata and exact SHA256/byte-length descriptors. Unknown versions/states, malformed/duplicate/overflow/nonmember IDs fail closed.
- `GET /peer-sessions/{uuid}/audio/{receiverId}?generation=...`: exact verified bytes, not a bare-ID audio fallback. No client bind/materialize endpoints.
- States: receiving, unresolved Tracks, unavailable/partial/changed assets, awaiting desktop materialization, stale binding, source invalid, resolved-awaiting-validation. Rejected conflict receipts describe separate evidence; they do not rewrite original readiness.

## Native behavior

- Received entries join normal Session history with namespaced row keys and original provenance. Unready entries expose status/dependencies, not normal replay. Ready entries still require fresh detail validation.
- Metadata persists for inspection. Open/start/resume/seek/load require desktop generation validation; no offline cached-ready replay fallback.
- Peer audio uses a separate generation/source/receiver-ID/digest cache. Both downloaded and reused bytes must match manifest length/SHA256. Invalid or interrupted downloads never become valid assets.
- Track labels, grids/cues and source identity come from guarded receiver metadata, not a possibly stale phone Library row. Native loads have generation-qualified source IDs.
- Decoded reuse also requires the verified load's PlayerModel request generation and native snapshot load ID. A same-label decoded replacement cannot inherit readiness. Importing is never a ready decode receipt; live replacement stops peer replay instead of silently continuing.
- Normal Session playback is unchanged. Legacy fresh lists prune old source-UUID cache visibility; generation-marked details cannot enter the old offline Session path.
- Known received UUIDs fence every entry source, including phone-recorded copies, stale caller headers, direct model show/start/seek and cached summaries. Same-UUID local evidence remains on disk but deduplicates to the current guarded received entry; unavailable/ambiguous mappings refuse replay, never raw-ID fallback.
- A durable UUID fence survives metadata-list omission and repository restart. Unreadable authority state fails closed; it cannot silently restore a recorded/cache entry's old IDs. A newly discovered collision closes an already-open unscoped view/replay without deleting its evidence.
- Refresh records an authority-write intent before fetching new identities and publishes learned IDs in memory before fallible cache writes. Failed writes retain the fence; interrupted/partial authority is unknown on restart, not an older empty permission to replay. Rejected/unreachable lists preserve prior authority without a false pending refresh.
- No peer bare-ID waveform, stem or diagnostic-probe requests. The current timeline can show no waveform until local analysis is available; this is not an audio-readiness claim.

## Checks

- `android/`: `./gradlew :library:test :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin` with JDK17/SDK35 and an owned nonexistent `manadj.snapshot` path.
- `PeerSessionsTest`: paired protocol, exact retry/cache, missing/rebound/corrupt/unpaired/offline/unknown/foreign-ID guards, generation-marked legacy-cache refusal.
- `PeerSessionUiTest`: actual Session screen/model/repository with audio-only host double; received status, partial inspection, fresh seek/resume and cached-ready refusal. Optional `-Dmanadj.peerScreenshots=<owned-dir>` writes native host raster PNGs.
- `PeerSessionNativeChainTest`: opt-in actual independent migrated A→B→paired HTTP→Kotlin repository→ReplayDriver→native Engine callback with downloaded PCM WAV. Requires fixture/binary variables below; otherwise explicitly skips.

From the repo root, using an owned scratch directory and the frozen #441 backend tree (or this repo after integration):

```sh
uv run --with rfc8785 --with pytest --with uvicorn scripts/agent/peer_android_fixture.py \
  --backend-source "$BACKEND_SOURCE" --scratch-parent "$SCRATCH" --receipt "$SCRATCH/fixture.json"
clang++ -std=c++17 -O1 -Iandroid/audio-engine/src/main/cpp/third_party \
  -fsanitize=address,undefined android/audio-engine/src/main/cpp/Engine.cpp \
  android/audio-engine/src/test/cpp/PeerReplayBridge.cpp -o "$SCRATCH/native-replay"
```

Run Gradle from `android/` with absolute `MANADJ_PEER_FIXTURE_RECEIPT` and `MANADJ_NATIVE_REPLAY_BRIDGE` paths. The fixture binds loopback on an allocated free port, uses newly generated DB/audio only and cleans up on normal shutdown. Its local fixture-control routes mutate decoys only; never expose this server.

Native chain assertions: source Track1→receiver9 despite unrelated receiver1; partial receipt/restart/retry/materialization; initial/seek/pause/resume positions within one output sample; nonzero rendered PCM; zero late ops; deleted desktop asset and same-ID/same-bytes new incarnation refuse old cached generation.

Not proved by host tests: Android MediaCodec/JNI/Oboe, physical speaker alignment, installed-phone lifecycle or private Sessions. Source/host/native callback/device statuses must remain distinct.

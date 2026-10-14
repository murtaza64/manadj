# Native audio module (#370)

Android library `android/audio-engine`, namespace `dev.manadj.audio`, included by the root `android/` build. Oboe 1.11.0 ([release](https://github.com/google/oboe/releases/tag/1.11.0)), NDK `27.0.12077973`.

## API

- `load(deck, sourceId, descriptor)`: duplicates the caller's descriptor (must be seekable), queues `Prepare`, starts the deck's decode worker. Receipt = queued.
- `submit(AudioCommand)`: one seam for UI, Session replay and future Conductor. Cue/hot-cue gating and relocations are decided on the audio callback against authoritative deck state (desktop `transport.ts` semantics); receipts mean queued, `appliedCommandId` means applied.
- `snapshot()`: output-frame clock and per-deck source position, cue, hot cues, `filling` (relocation refill in progress: silent, clock held), `atEnd`. Compose does not advance playback time.
- `SetCrossfade`: -1 = A only, 0 = both unity, +1 = B only.
- `close()` off the main thread. Unsupported EQ/FX/stems/scratch/loops/key-lock/sync/PFL are absent from `supportedCapabilities`.

## Model

- Four 65536-frame stereo float rings (2 MiB). Sources decode incrementally (MediaExtractor + MediaCodec, float output when the decoder allows; raw 8/16/24/32-bit/float WAV).
- Every relocation (load, seek, cue return, hot-cue jump) bumps the deck's `transport` on the callback. The deck worker seeks its decoder in place (extractor seek + codec flush), resets the ring (worker-owned indices), refills and publishes; the callback renders only `ring == transport`, so stale PCM is never audible.
- Load status is `(loadId << 2) | state`; READY/ERROR are CASes a superseded load cannot win.
- Callback: no locks, allocation or I/O. ~5 ms fade-in on every start, fade-out on pause/cue stop. Relocation while playing cuts (no fade).
- Output disconnect: Oboe closes the stream; `onErrorAfterClose` opens a replacement (engine state survives). `reopen()` retries a failed recovery; the app service calls it every 2 s while `outputOpen` is false.
- Seeking past the end parks the deck (`atEnd`), not an error.

## Tests

- Native transport/mixer: `clang++ -std=c++17 -O1 -fsanitize=address,undefined android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/EngineTest.cpp -o /tmp/manadj-engine-test && /tmp/manadj-engine-test`
- Device/emulator: `./gradlew :audio-engine:connectedDebugAndroidTest` from `android/` (generated WAV/AAC decoys only).

Not verified: physical-device latency, real disconnect recovery (emulator has no route changes). No latency target is inferred from requesting Oboe LowLatency.

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
- Pre-decoded heads: a second decoder per deck keeps 8192 frames at each hot cue and the main cue. A cue/hot-cue relocation whose head matches plays from it instantly; the ring refills from the head's last frame and the callback hands off sample-continuously. Heads being played are busy (worker cannot overwrite).
- Callback: no locks, allocation or I/O. ~5 ms fade-in on every start; every pause/stop/relocation captures a short tail of the old audio and crossfades it out (no hard cuts). Seeks without a head still have a ~10–20 ms silent refill after the fade.
- Channel strip (desktop parity, `Dsp.h`): trim → 3-band isolator EQ (LR4 crossovers 250 / 2500 Hz, knob .5 = 0 dB, 1 = +6 dB, 0 = kill; `SetEq`) → sweep filter (desktop default `res24` model: deadzone ±0.03, LP to 40 Hz / HP to 16 kHz, +17 dB resonance with 0.85 peak compensation, 20 ms cutoff smoothing; `SetFilter` -1..1) → fader/crossfader to master, and pre-fader to cue. Filter targets (peak search) are computed on the submitting thread. 4 decks with EQ + filter: ~115 µs per 96-frame callback on the phone (2 ms budget).
- Grid / jumps / loops (desktop `beatjump.ts`, `loop.ts`, `transport.ts`): `SetGrid(bpm, anchor)` constant-tempo grid (local files: ID3 TBPM anchored at 0 s; library grids from #372). `BeatJump(beats)` is a relative displacement (gridless: 120 BPM) that carries an active loop with it. `LoopToggle`/`LoopPreset`/`LoopResize` engage at the playhead (nearest beat under `SetQuantize`), 1/8..128 beats, resize anchored at the start (a stranded playhead folds back in), absolute relocations (seek, cue, hot cue) cancel the loop; gridless tracks: engage is inert. The callback wraps at the loop end within a block, playing the loop start from its pre-decoded head (slot 9) with the sub-frame overshoot carried over, crossfaded like any relocation.
- Buses: master (trim × fader law × crossfader) and cue/PFL (trim only, pre-fader; `SetPfl`), headphone feed = cue blended to master by `SetCueMix`. `configureOutput(routing, deviceId)` maps them: STEREO (master), SPLIT_MONO (L mono master / R mono cue), QUAD (ch1/2 master, ch3/4 cue; reopens the stream with 4 channels — offer only for devices reporting ≥4 channels, e.g. a DDJ-GRV6). Reconfiguring replaces the stream; engine state survives.
- Output disconnect: Oboe closes the stream; `onErrorAfterClose` opens a replacement (engine state survives). `reopen()` retries a failed recovery; the app service calls it every 2 s while `outputOpen` is false.
- Seeking past the end parks the deck (`atEnd`), not an error.

## Tests

- Native transport/mixer: `clang++ -std=c++17 -O1 -fsanitize=address,undefined android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/EngineTest.cpp -o /tmp/manadj-engine-test && /tmp/manadj-engine-test`
- Device/emulator: `./gradlew :audio-engine:connectedDebugAndroidTest` from `android/` (generated WAV/AAC decoys only).

Not verified: physical-device latency, real disconnect recovery (emulator has no route changes). No latency target is inferred from requesting Oboe LowLatency.

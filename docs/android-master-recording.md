# Android Master audio recording — #425

Port: now (native Android parity with desktop Master recording).

## Source and boundaries

- Clean-main slice; no dependency on unapproved desktop #414/#415 or #422/#420/#97 work.
- `Engine.render`: copies the logical stereo Master after channel-strip/crossfade/master Beat FX and `ceiling`, before physical Stereo/SplitMono/Quad mapping. The private PFL bus and calibration chirps are excluded. No additional gain is applied; disk worker quantizes to signed PCM16.
- `MasterRecorder`: engine-lifetime preallocated stereo queue (262,144 frames, about 2 MiB). Callback performs bounded copies and lock-free atomics only; generation tokens reject late blocks from a previous recording after rapid stop/start. A dedicated worker converts/writes; control threads start/stop/join without holding the UI snapshot monitor. Overflow, rate changes and WAV/RIFF size exhaustion are errors, never silent dropped-frame success.
- Normal stop drains the final partial block, patches the 44-byte stereo WAV header with actual frame count/sample rate, fsyncs/closes, renames `.partial` to `.wav`, and fsyncs its directory. Failure/cancel/interruption never appears as a completed shareable recording. Existing remnants are retained, not overwritten.
- `PlaybackService` owns recording with the existing engine and foreground playback notification. Activity/view/layout changes do not create a recorder. Focus/noisy interruptions and native stream replacements/disconnects stop capture as incomplete. Service shutdown interrupts capture; the next service instance reports retained `.partial` files.
- Global controls sit outside performance/settings/Session content. SAVED exposes only finalized `.wav` files. FileProvider grants temporary read access for explicit native share; EXPORT copies to the user's document URI off main. Neither action deletes the original or uploads automatically.
- Files: app `filesDir/master-recordings/manadj-master-<timestamp>-<random>.wav`. No new microphone/storage permission. Existing Session event capture/replay is unchanged. Session UUID attribution is not attached in this first global-bus slice; a recording may span live and replay sources.

## Verification receipts

Host native checks use synthetic generated signals and temporary decoy files only:

```sh
clang++ -std=c++17 -O1 -pthread -Iandroid/audio-engine/src/main/cpp/third_party -fsanitize=address,undefined android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/MasterRecorderTest.cpp -o /tmp/opencode/manadj-master-recorder-test
/tmp/opencode/manadj-master-recorder-test
clang++ -std=c++17 -O1 -pthread -Iandroid/audio-engine/src/main/cpp/third_party -fsanitize=address,undefined android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/EngineTest.cpp -o /tmp/opencode/manadj-engine-425-test
/tmp/opencode/manadj-engine-425-test
g++ -std=c++17 -O1 -pthread -Iandroid/audio-engine/src/main/cpp/third_party -fsanitize=thread android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/MasterRecorderTest.cpp -o /tmp/opencode/manadj-master-recorder-tsan
/tmp/opencode/manadj-master-recorder-tsan
```

- Recorder ASan/UBSan: passed. Frame/header/rate/channel checks; byte-identical logical Master across all routing modes; physical Stereo/Quad sample agreement; private cue exclusion; EQ/fader/trim/crossfade/master FX path; final partial block; repeated recording; concurrent producer drain; no overwrite; overflow/RIFF limit; storage/full-disk and final-header error seams; cancel/interruption/restart remnants.
- Existing EngineTest ASan/UBSan: passed.
- Recorder TSan: passed; no race report in the exercised native producer/worker paths.
- Android Kotlin/JNI/APK build: debug APK assembled for arm64-v8a/armeabi-v7a/x86/x86_64, app ID `dev.murt.manadj.recording425`, version `0.1.0-rc.6` / code 6. Isolated Temurin JDK17.0.21+9, SDK35 revision 2, build-tools35.0.0, NDK27.0.12077973, CMake3.22.1; no system toolchain replacement. SDK setup/license acceptance was explicitly approved in attention `2eca35e8-bbd3-4a4f-8c4d-81d28c91c2ab`, operator answer `b8189573-aaf5-4845-9885-65b26e3f8ef3` (2026-11-01).
- Focused app `MasterRecordingsTest` (2 tests), audio-engine JVM and library JVM tasks passed. Full app JVM run: 25 tests, one failure in unchanged `HypermeterTest.resetMarkSetsThePhase`: its fallback fixture supplies `categories`, while unchanged `SnapshotJson.parse` requires `tag_categories`. This unrelated failure is retained/reported, not silently fixed or called green.
- Initial APK compile found an Intent `setClipData` chaining error; corrected before successful assembly. APK hash, signing certificate and exact source identity are retained in the lane's immutable build receipt. Debug signing is lane-local; no phone signing key was imported.
- Native share/export chooser, Android lifecycle/rotation/background and actual-device record → share/export → playback/duration: **not yet verified**. No APK/install/device-proof claim follows from host tests.

## Pending owner-coordinated proof

1. After toolchain authority, build/test from an exact frozen source. Use lane-local Android user/signing state and a review app-ID suffix; do not import/move the phone signing key.
2. Existing reviewer checks source/native receipts and resulting APK identity independently.
3. In an explicitly scheduled device window, use synthetic/licensed input: record a short live transition, stop, share/export, play it back, compare stereo/duration, and repeat through Session replay.
4. Check PFL isolation, rotation/background, focus/noisy/route interruption, cancellation and saved-file persistence. Report source-tested/build/device-tested/installed separately.

Not authorized: phone install, pairing reset, real/private-media capture, private upload, host/runtime restart, landing or gate waiver. Mobile clip/visualizer editing remains phase 2.

# Native Android performance lab — #365, iteration 3

- Standalone Kotlin/Compose; no WebView, audio or desktop connection.
- In-memory fake tracks: duration, BPM/key, eight cues, distinct cached waveform envelopes, elapsed-time playback, pitch, beat jumps and anchored loops.
- Three layouts: dual workspace; permanent dual mixer plus selected deck; all-controls landscape.
- Dense layout needs **760×360dp**, after real cutout insets. Transport fills the bottom edge; gesture cancellation is handled rather than reserving a blank bottom band.
- Knobs: relative capture, bounded neutral notch, double-tap reset, hold precision. Full faders: physical rail mapping and preserved handle-grab offset, no hold expansion.
- Minimap seek, detail-wave scrub, momentary bend, continuous hold-drag beat/loop wheel, gated hotcues and one central routed FX section.
- Performance surfaces do not scroll. Library and INFO can scroll.

## Existing toolchain

From the lane repo root; reuse `.lane-tmp/`:

```sh
export JAVA_HOME="$PWD/.lane-tmp/toolchains/jdk-17.0.20.1+1/Contents/Home"
export ANDROID_HOME="$PWD/.lane-tmp/android-sdk"
export ANDROID_AVD_HOME="$PWD/.lane-tmp/android-avd"
export ANDROID_USER_HOME="$PWD/.lane-tmp/android-user"
export GRADLE_USER_HOME="$PWD/.lane-tmp/gradle-home"
export ANDROID_SERIAL=emulator-5580
./prototypes/android-performance/gradlew -p prototypes/android-performance :app:assembleDebug
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 install --no-streaming -r prototypes/android-performance/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 shell am start -n dev.manadj.phonelab/.MainActivity
```

Signing identity is pinned to the existing ignored `.lane-tmp/android-user/debug.keystore`. Iteration 3 updates iteration 2 in place. Do not regenerate or commit that keystore. Iteration 1 had a different identity.

## Verification

```sh
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 shell wm density 160
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 shell wm size 360x640
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 shell settings put system font_scale 1.3
./prototypes/android-performance/gradlew -p prototypes/android-performance :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.manadj.phonelab.NativeGesturesTest,dev.manadj.phonelab.FakeTrackBehaviorTest,dev.manadj.phonelab.NativeRotationTest
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 shell wm size 800x360
./prototypes/android-performance/gradlew -p prototypes/android-performance :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.manadj.phonelab.DenseGeometryTest
```

23 device tests passed at 1.3× font: physical fader travel/cancel, knob reset/notch, wheel commit/cancel, gated cues/Play takeover, seek/scratch, momentary bend, simultaneous controls, deferred routing, loading, transport parity, rotation and dense 48dp capture bounds. Logs: `.lane-tmp/iteration3-tests-dense.log` and `.lane-tmp/iteration3-test-device.log` (22-test zero-failure device summary; outer Gradle collection exceeded its timeout).

Mounted compact workspace/mixer inspected during implementation. Desktop references: `frontend/src/playback/{transport,beatFx,mixerMath}.ts`, `frontend/src/waveform/{styles,WaveformRendererV2}.ts`, `frontend/src/theme/markers.ts`. RGB bands are generated fixtures, not real analysis. Physical-cutout behavior is unverified.

SwiftShader frame timing was variable and slow; `.lane-tmp/iteration2-gfx-10s.txt` records the sample. This does not establish physical-device touch latency or smoothness. Internal captures are debugging references, not review deliverables.

## Review

```sh
uv run prototypes/android-performance/stage.py
```

Existing server: <http://127.0.0.1:5190/review.html>. Serves only `.lane-tmp/public-review/`; APK plus brief usage. Prior APKs remain unchanged; current is `manadj-iteration3.apk`. Server log: lane-root `native-review-server.log`; stop the existing server with `kill 80181`.

The Gradle wrapper pins its distribution checksum. Ubuntu Mono font licence: `UBUNTU_FONT_LICENCE.txt`. Prototype remains unlanded.

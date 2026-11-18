# Verification record

Implementation snapshot: November 18, 2026. Base commit `d137e2d7`.

## Passed here

Environment: Linux x86_64, official Swift 6.0.3 toolchain, g++ portable-engine host build. These are not iOS execution results.

| Check | Result |
|---|---|
| `swift test --package-path ios/Packages/ManadjCore` | 19 tests passed, zero failures. Latest full run around 09:26 PST. |
| Follow golden | 49 existing desktop/Android cases, 1,996 output rows. Exact order and labels; compatible scores within 1e-9. Backend BPM-gate candidate fixtures also pass. |
| Snapshot/waveform/cache checks | Missing/duplicate/invalid identities, unsupported snapshot version, scalar settings, huge BPM overflow, every truncated waveform prefix, invalid binary dimensions, gamma/timing, atomic preservation of last good cache, and quarantine/recovery of an unreadable saved snapshot. |
| HTTP integration | Synthetic loopback Python server: pairing ticket/poll, snapshot, preview pack, unauthorized response, complete audio download, revision mismatch, byte-length mismatch, old target preservation and redirect rejection. The redirect capture endpoint received zero requests. No real library or credentials used. |
| `swift test --package-path ios/Packages/ManadjAudio` | 4 tests passed, zero failures. Latest full run around 09:27 PST. |
| AddressSanitizer bridge suite | All 4 audio-bridge tests pass with `--sanitize address` on Linux, leak detection disabled. Latest run around 09:26 PST. Includes the grid command path after fixing an auxiliary-array length defect found during review. |
| Android filter/playlist parity | Existing Android FilterTest expectations ported: search, any/all tags, energy/nulls, folded BPM windows, key selection, null-last sort and curated playlist order. Exact inclusive BPM-boundary tests added. |
| Repository correctness | Concurrent sync is rejected without replacing active work; bulk download skips unavailable audio; cached audio remains available after reopening; cache presence requires a nonempty regular file matching expected length. |
| C ABI whole-track check | Real shared C++ engine through Swift: prepare, decode buffer handoff, readiness, nonzero synthetic output, expected transport position, pause/seek and stale-load rejection. |
| C ABI streaming check | Ring backpressure, 44.1→48 kHz playback timing, nonzero output, seek/refill, stale transport rejection and EOF stop. This does not execute AVAudioFile. |
| Master recorder check | Finalized RIFF/WAV with expected byte count; existing completed file is not overwritten. |
| Existing portable C++ `EngineTest` | Passed with g++ `-O1` before the new bridge work. Portable engine source is unchanged. |
| iOS-target source parse | Swift frontend accepted app/audio/native-test/UI-test source syntax with `-target arm64-apple-ios17.0`. Parsing does not resolve Apple types or link frameworks. |
| Clean-checkout reproduction | Applied the generated patch to an untouched detached `d137e2d7` worktree. Both host packages rebuilt there and passed all 19 Core + 4 bridge tests around 09:29 PST. All 51 delivered source/resource files matched byte-for-byte. |
| Xcode project structure | Generated deterministically; OpenStep parser accepts the project, shared scheme is XML, Info.plist is valid XML plist. This does not substitute for `xcodebuild`. |
| Icon asset | Actual generated 1024×1024 app icon inspected. Uses the repository logo on black. This is not an app screenshot. |

## Not passed, not claimed

- Apple SDK typechecking or linking of the SwiftUI/AVFoundation code.
- Simulator launch, native decode/output test, UI tests or screenshots.
- iPhone install, real audio listening, latency/drift/CPU/memory measurements.
- Headphone unplug, Bluetooth/USB routing, interruptions and media-services reset on iOS.
- Long-file AVAudioFile seeking/refill and compressed-codec accuracy on iOS.
- Four simultaneous real tracks or thermal/background behavior.
- End-to-end recording share/export on iOS or native failure-injection cases.
- Full Android feature parity. See `FEATURE_COVERAGE.md`.
- Full portable-engine sanitizer proof. An earlier monolithic C++ sanitizer build exceeded its execution window. The separate 4-test C bridge suite now passes AddressSanitizer, but that is narrower coverage and leak detection was disabled.
- Complete branch publication, pull request, merge, release build, signing or paid service setup. Partial text publication is recorded below.

## Apple verification path

A personal Mac with Xcode 16+ and an iOS simulator runtime can run:

```sh
bash ios/scripts/verify_apple.sh
```

This first runs both host packages, then unsigned simulator build/test. `ManadjTests/NativeAudioTests.swift` generates a real WAV, decodes it through AVAudioFile and checks transport through AVAudioEngine. `ManadjUITests/WorkspaceUITests.swift` launches the app, visits C/D and Settings and attaches actual screenshots to the `.xcresult`.

Those Apple tests are prepared work, not evidence that they pass. Fix any compile/runtime failures first, inspect the actual screenshots, then update this record with the Xcode/runtime/device versions and resulting artifacts. Simulator verification does not require an Apple Developer enrollment, a signing account or company access.

## Publication checkpoint, November 18, 2026, 11:26 PST

- The complete prepared tree rebuilt from scratch at 10:35 PST: 19 Core tests and 4 bridge tests passed again. Xcode project regeneration did not change the checked-in project.
- `instinct/ios-app` contains 47 intended text files, verified byte-for-byte. Publication is incomplete: the icon, two fonts, golden snapshot and workflow are not yet remote. A duplicate-path `.gitignore` from the initial editor attempt is queued for removal.
- The complete corrective source is prepared locally. GitHub binary-upload commit attempts returned HTTP 400 without landing. Permission for a temporary write key restricted to the personal repository is pending. No key has been generated or added.
- The unsigned simulator workflow targets standard `macos-15`, with pinned actions, read-only contents permission, a 25-minute timeout and three-day evidence retention. It has not run. No Apple SDK or simulator success is claimed.

## First Apple CI, November 18, 2026

Complete publication was verified at `fca40101`: 52 intended files match the prepared tree byte-for-byte and the duplicate path is absent. The repo-only temporary key was authorized through November 25, 11:51 PST; no company access or Apple enrollment was used.

Run 44384968318 used Xcode 16.4 / iOS Simulator SDK 18.5 and reached app compilation after the host package tests. It failed because `HoldControl.Coordinator.release()` collided with the inherited Objective-C `release` selector. The callback is renamed `endHold`, retaining touch-up, touch-cancel and dismantle handling. A rerun is required; no app build/runtime pass is claimed.

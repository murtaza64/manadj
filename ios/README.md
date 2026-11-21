# manaDJ iOS, native implementation in progress

This is an initial implementation, not a working-release or Android-parity claim.

**Verification boundary:** Xcode 16.4 built the unsigned app and all 3 native/UI tests passed on an arm64 iPhone 16 Pro simulator running iOS 18.5. The native test decodes a generated WAV through AVAudioFile and verifies play/pause/seek transport through AVAudioEngine. Actual empty-workspace and Settings screenshots were inspected. The 19 Core and 4 C-bridge host tests also pass. This is not physical-iPhone, listening, loaded-library, long-file or full Android-parity proof. No installable IPA is provided. See [VERIFICATION.md](VERIFICATION.md) for the source run.

## Architecture

- `Packages/ManadjCore`: Foundation-only Swift library models, snapshot parsing, query/filter/sort, Follow ranking, waveform formats, revision-keyed offline cache, pairing and HTTP sync.
- `Packages/ManadjAudio/Sources/CEngine`: small C ABI compiling the unchanged Android portable C++ engine in place. This is not JNI, Oboe, a web view or a rewritten DSP engine.
- `Packages/ManadjAudio/Sources/ManadjAudio`: Swift AVAudioEngine/AVAudioSourceNode output and AVAudioFile decoding. Main-actor controls, one serial decode worker per deck, fixed scratch space in the callback. Short tracks fully decode within a 64 MiB/deck ceiling; larger tracks stream through the existing bounded ring and refill on transport changes. That is a memory ceiling, not a duration rejection or truncation.
- `Manadj`: SwiftUI workspace, native Files picker, UIKit touch tracking for gated pads, desktop pairing, Keychain token storage, offline library and native recording share sheet.
- `Manadj.xcodeproj`: checked-in app/test project and shared scheme. `scripts/generate_project.py` regenerates it without third-party tooling.

The initial deployment floor is **proposed iOS 17**, not an approved product decision. Android parity gaps remain open, listed in [FEATURE_COVERAGE.md](FEATURE_COVERAGE.md).

## Open on a personal Mac

Requires Xcode 16 or later, an installed iOS simulator runtime, Swift 6 and Python 3. No Apple Developer enrollment, signing account, third-party service or purchase is needed for simulator verification.

1. Open `ios/Manadj.xcodeproj` from the full repository checkout. The shared C++ sources remain under `android/audio-engine`, so copying only the `ios` directory is not enough.
2. Select the `Manadj` scheme and an iPhone simulator.
3. Build/run. For scripted unsigned build and tests, from the repository root:

   ```sh
   bash ios/scripts/verify_apple.sh
   ```

   Set `DESTINATION_UDID` to select an existing simulator. The script runs host packages, builds the simulator app without signing, runs native/UI tests and leaves an `.xcresult` with screenshot attachments. These tests passed in the GitHub-hosted simulator run linked in the verification record. Physical-iPhone testing remains open.
4. On a physical iPhone, signing and a personal development team must be configured separately. Do not use a company account for this work.

## Host verification

```sh
swift test --package-path ios/Packages/ManadjCore
swift test --package-path ios/Packages/ManadjAudio
# Optional host memory-safety check (leak detection disabled for the Swift runtime):
ASAN_OPTIONS=detect_leaks=0 swift test --package-path ios/Packages/ManadjAudio --sanitize address
```

The Core integration tests start a loopback-only Python fixture with synthetic audio and fake tokens. They do not access a real desktop library or account. See [VERIFICATION.md](VERIFICATION.md) for the actual checks run and the remaining gates.

## Implemented app flow, broader device validation pending

- Perform has A/B and C/D workspaces, pads, cue/play, loop/jump, pitch/bend, key lock, EQ/filter/fader/PFL, crossfader and Beat FX.
- Files imports a platform-decodable mono/stereo file into app-owned storage. Ogg support is not promised by AVFoundation.
- Settings pairs with the desktop's opt-in Phone sync LAN listener. Match the code on the desktop. The token is saved in device-only Keychain storage, not UserDefaults or source.
- Sync caches the snapshot and previews. Audio downloads on load, or through a separately confirmed all-audio download. Downloaded files must match `X-Audio-Rev` and the snapshot size before atomic replacement.
- Library supports search, playlists/play order, sort, single-tag and exact-energy selection, downloaded-only and Follow. The core supports more filters than the current UI exposes.
- REC captures the engine's stereo master into a finalized WAV. Only completed `.wav` files appear in Saved recordings. Interrupted/failed `.partial` files are not offered as saved recordings.

## Important current behavior

- The LAN listener uses HTTP, like Android. The app explains that traffic and pairing credentials are not encrypted on that connection. Use a trusted private network. Redirects are rejected rather than forwarding credentials.
- Large streamed tracks have seek/refill support, but do not have the full-track buffer required for key lock. The UI explicitly reports varispeed fallback when key lock is requested. This is a parity gap, not an approved permanent limitation.
- Cue, hot-cue and mixer changes affect the running engine only. They are not persisted or pushed to the desktop. There is no claim of two-way sync.
- Output route changes/interruption pause playback and invalidate an active recording. Playback does not resume automatically. Media-services reset currently requires closing and reopening the app.
- Four-channel USB cue routing, remote transport controls, restored deck state, saved imports browser and storage cleanup are not implemented yet.
- No removed Soulseek or SoundCloud download behavior is ported. The base is `d137e2d7`, after the piracy-removal change.

Implementation changes are confined to `ios/` and its unsigned simulator CI workflow. Apple signing setup and paid services are outside this change.

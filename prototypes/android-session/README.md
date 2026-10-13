# Native Session lab · #368

`dev.manadj.sessionlab`, separate from the performance app. Silent Compose replay model; no PCM, audio engine, acoustic parity or production landing.

## Try

- Play/pause and ±10 seconds share the Session clock across A–D, timeline and list.
- Tap timeline to seek; drag to pan; pinch or ± to zoom. FIT restores the complete Session; ↦ follows its playhead.
- Scroll the tracklist independently. Tap an occurrence to seek its first recorded sound (or load time for loaded-only entries).
- IMPORT accepts saved `GET /api/sessions/{uuid}` JSON, then metadata from `GET /api/tracks/` (paginated `items`, or a Track array). Import additional metadata pages as needed. Use the **same desktop library**: IDs are not portable identities.
- A new Session clears metadata. Unresolved IDs remain visible. Invalid/unsupported imports leave the previous Session intact and paused. Reload fixture is in IMPORT.
- Backgrounding pauses. Relaunch/recreation resets to the bundled fixture; imports are not persisted.

## Compatibility

- Actual unversioned `SessionDetail`: `uuid`, `started_at`, `ended_at`, `take_count`, ordered `events`. No new export/sync protocol.
- Physical A/B/C/D, nonzero capture origin, stable equal-time ordering; load does **not** infer pause. Pitch-aware position reconstruction, tick anchors, play/pause/cue, seek/jump/hotcue, gated previews, loop region/resolved landing, fader/trim/EQ/filter/stems/crossfader, tenure masking.
- Current desktop reducer defaults and loop folding are ported; checked against `stateAt` at 20 fixture instants. List entries are **load occurrences**, not unique tracks or a Set. Timeline waveforms show recorded direct audibility and source-time discontinuities.
- Active Beat FX/tails, scratch trajectories, Take `init`, unknown kinds/controls/actions and explicit version fields are **refused**, not silently ignored. Inactive FX and voicing are accepted as evidence. Bend/PFL/master do not control model replay (desktop replay-planner/live-user distinction).
- 8 MiB / 50,000-event import bounds. No large-library performance claim.
- Metadata uses actual `PaginatedTracks`/`Track` fields and Engine key IDs. All waveform bands are deterministic **synthetic analysis**, indexed by track ID and recorded source position; no real MWF1/media hydration yet.
- No live controls, capture writer, audible-surface claim or takeover implementation. Session navigation retains this read-only model; eventual replay must bind the shared native engine (#370) and performance takeover contract (#369), not reuse the visual timer as an audio clock.

## Build and verify

Requirements: JDK17; Android SDK command-line tools; platform35/build-tools35.0.0; internet for Google/Maven/Gradle dependencies. The committed wrapper pins Gradle8.11.1 and its official distribution SHA256; AGP8.9.2 and Kotlin2.1.20 are pinned in the build. No sibling checkout/toolchain is required. Checked-in fixtures are sufficient to build the APK; Node/Python are only needed to regenerate/validate them or serve the review page.

On macOS, install JDK17 and Android SDK tools (Android Studio's SDK Manager is sufficient). From this checkout's root, set paths for **this machine**:

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_USER_HOME="$PWD/.lane-tmp/android-user"
export ANDROID_AVD_HOME="$PWD/.lane-tmp/android-avd"
export GRADLE_USER_HOME="$PWD/.lane-tmp/gradle-home"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
mkdir -p "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME" "$GRADLE_USER_HOME"
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator"
./prototypes/android-session/gradlew -p prototypes/android-session :app:assembleDebug :app:assembleDebugAndroidTest
```

For an Apple-silicon emulator, install `system-images;android-35;google_apis;arm64-v8a`, then create an AVD with `avdmanager create avd -n session_368 -k 'system-images;android-35;google_apis;arm64-v8a' --device pixel_6`. Intel hosts use the corresponding `x86_64` image. Verify console/ADB ports5582/5583 are free before launching `"$ANDROID_HOME/emulator/emulator" -avd session_368 -port 5582 -no-snapshot`. A physical Android8+ device also works; substitute its explicit serial below. Leave performance5580/review5190 alone.

Fixture regeneration uses Node22.12+ and the committed `frontend/package-lock.json` (original run: Node26.4.0). Schema validation uses uv, Python3.13+ and the repo's `uv.lock`:

```sh
# From frontend/
npm ci
npx vitest run --config ../prototypes/android-session/fixture.config.ts
# From repo root
uv run --locked -m prototypes.android-session.validate_fixture
adb -s emulator-5582 install -r prototypes/android-session/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5582 install -r prototypes/android-session/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5582 shell am instrument -w dev.manadj.sessionlab.test/androidx.test.runner.AndroidJUnitRunner
adb -s emulator-5582 shell am start -W -n dev.manadj.sessionlab/.MainActivity
# Check5192 is free first. Foreground server: Ctrl-C stops it.
uv run --no-project --python 3.13 prototypes/android-session/serve.py --port 5192
```

Do **not** use unrestricted `connectedDebugAndroidTest`: Gradle discovers foreign emulators too. This lane uses build-only Gradle and explicit serial-targeted instrumentation. Performance emulator5580/review5190 remain foreign.

### Signing and artifacts

- Debug signing uses the checkout-relative `.lane-tmp/android-user/debug.keystore`. Gradle creates it locally; it is ignored and **not transferred in Git**. No release signing configuration is supplied.
- To update an already-installed reviewed APK, transfer that debug keystore separately through an approved secure channel. Otherwise uninstall **only** `dev.manadj.sessionlab` and install the newly signed APK. New local signing/builds need not match the reviewed APK hash. Never publish key contents/passwords in the tracker.
- APK: `prototypes/android-session/app/build/outputs/apk/debug/app-debug.apk`. The review server serves its startup snapshot at `/manadj-session.apk` and brief notes at `/review.html`; restart after intentionally replacing an APK. No source, caches, media or capture gallery is served.
- Build outputs, SDK/AVD/Gradle caches, private signing material and inspection captures remain untracked. No real database/media is needed for the fixture or tests.

## Frozen verification record

- [Parked walkthrough and test evidence](https://github.com/murtaza64/manadj/issues/368#issuecomment-6157303361): **14/14** native instrumentation tests passed on API35 ARM64 at390×844/font1.0 and360×640/font1.3.
- Tests exercised desktop `stateAt` golden parity at20 instants across A–D; loop/preview/jump/equal-time load order; unknown/version/activeFX rejection; seek/list/strip synchronization; independent scrolling; play/pause/end; pan/zoom and background pause.
- Desktop planner fixture test and `SessionDetail`/`PaginatedTracks` schema validation passed. Manual Android document-picker import first showed unresolved IDs, then hydrated matching metadata. Mounted compact/tall layouts inspected; no captures are deliverables.
- Review HTTP200 on loopback/LAN, served/build APK SHA256 matched, source/fixture URLs404. Repository had one Alembic head `0043_zpron`; this prototype has no migrations.
- Reviewed APK SHA256: `796a744e67c60bee33d1fb5c4c0b51a1a0b918132edb8b4703737a6714ff0b8e`. Portability closeout adds wrapper/docs only; it does not rebuild or change that APK or app behavior.
- Closeout checks: wrapper downloaded and checksum-validated Gradle8.11.1, `--version` and project `help` passed; wrapper JAR matches official SHA256 `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`. Desktop fixture generation/test and schema validation passed again with unchanged fixtures. The 14 native tests above are the original reviewed build's evidence, not a new personal-laptop run.
- Historical work-laptop review: http://127.0.0.1:5192/review.html ; LAN http://192.168.1.177:5192/review.html . These are not portable artifact hosting. Server PID56005, log `.lane-tmp/review.log`, stop `kill 56005` **on that host after checking PID ownership**. Emulator5582/PID61923, log `.lane-tmp/emulator.log`, stop `adb -s emulator-5582 emu kill` on that host. Both remain running for review.
- No physical-device feel, latency, real-audio or four-deck acoustic-parity certification. No prototype landing. #369/#370 continue independently; their proposed shared AudioEngine has stable DeckId A–D, explicit source-ID/PFD loads, commands/gesture IDs and output-frame/rate/epoch snapshots. Session seed scheduling and unsupported loop/FX/scratch capabilities still require integration and verification; desktop track-ID→URI mapping must fail explicitly when missing.

## Desktop sources

- `backend/routers/sessions.py`, `backend/schemas.py`: HTTP serialization; fixture validated through their Pydantic schemas.
- `frontend/src/capture/events.ts`, `audibilityReducer.ts`: capture vocabulary, transport-owned load semantics, defaults, gated previews, tenure masking.
- `frontend/src/sessions/{timelineModel,replayPlanner,SessionReplayDriver,SessionTimelineView}.ts*`: timeline/state reconstruction, replay seed/cues, clock/pause/seek, shared-engine takeover.
- `docs/adr/0033-sessions-persisted-event-log-live-deck-replay.md`; hydration research #367 and engine implementation #370.

`fixture.ts` constructs typed desktop CaptureEvents and emits SessionDetail, PaginatedTracks and golden desktop reducer/planner output. It includes four-way overlap, jumps, loop, preview, pitch, mute, unload, reload and a machine-tenure gap. No developer media or real DB is read.

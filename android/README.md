# manadj Android (#369)

Native Compose app (`:app`, id `dev.murt.manadj`; installs alongside the #365 prototype `dev.manadj.phonelab`) over the shared native engine (`:audio-engine`, see its README). ADR 0044.

## Build

- JDK 17, Android SDK platform 35. AGP installs the pinned NDK/CMake on first build.
- `JAVA_HOME=<jdk17> ANDROID_HOME=<sdk> ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- Debug signing: `MANADJ_ANDROID_KEYSTORE` (shared identity; password `android`, alias `androiddebugkey`), else `../.lane-tmp/android-user/debug.keystore` (gitignored), else the SDK default. A different key requires uninstall before install.
- Tests: `./gradlew connectedDebugAndroidTest` (emulator or device; generated decoy media only).

## Use

- LOAD → CHOOSE AUDIO FILE (any local audio the platform decodes: MP3, AAC/M4A, FLAC, WAV, OGG). Remembered files reappear in the list.
- Layout key (top right): L1 portrait workspace (PADS / MIX tabs, transports at the bottom); L3 dense landscape (both decks' pads + transport, central mixer, vertical detail rulers; needs ≥760×360 dp).
- CUE / hot cues: desktop semantics. Empty pad stores a hot cue at the current position; set pad is a gated trigger (hold to preview when paused, jump when playing).
- Ruler: drag to seek. BEND: hold left/right half, slide. Pitch key: varispeed ±8 %.
- Jumps/loops (PADS tab, under the pads): ◀n / n▶ jump by n beats (÷ × change n, 1..128); ½ ⟳n 2× loop (needs a BPM: ID3 TBPM tag on local files, else NO BPM). MIX tab: EQ HI/MID/LOW, FILTER, CUE (headphone PFL). Header status line → output routing panel.
- Marked PENDING: Beat FX, waveforms (ported by #371), key lock, sync, scratch.

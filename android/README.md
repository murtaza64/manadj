# manadj Android (#369)

Native Compose app (`:app`, id `dev.murt.manadj`; installs alongside the #365 prototype `dev.manadj.phonelab`) over the shared native engine (`:audio-engine`, see its README) and the synced Library (`:library`, #372). ADR 0044.

## Build

- JDK 17, Android SDK platform 35. AGP installs the pinned NDK/CMake on first build.
- `JAVA_HOME=<jdk17> ANDROID_HOME=<sdk> ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- Debug signing: `MANADJ_ANDROID_KEYSTORE` (shared identity; password `android`, alias `androiddebugkey`), else `../.lane-tmp/android-user/debug.keystore` (gitignored), else the SDK default. A different key requires uninstall before install.
- Tests: `./gradlew connectedDebugAndroidTest` (emulator or device; generated decoy media only); `./gradlew :library:test` (host JVM).
- `-Pmanadj.appIdSuffix=.<lane>` installs a lane build beside the shared one.

## Use

- LOAD opens the Library (below); FILES → CHOOSE AUDIO FILE (any local audio the platform decodes: MP3, AAC/M4A, FLAC, WAV, OGG). Remembered files reappear in the list.
- Layout key (top right): L1 portrait workspace (PADS / MIX tabs, transports at the bottom); L3 dense landscape (both decks' pads + transport, central mixer, vertical detail rulers; needs ≥760×360 dp).
- CUE / hot cues: desktop semantics. Empty pad stores a hot cue at the current position; set pad is a gated trigger (hold to preview when paused, jump when playing).
- Ruler: drag to seek. BEND: hold left/right half, slide. Pitch key: varispeed ±8 %.
- Jumps/loops (PADS tab, under the pads): ◀n / n▶ jump by n beats (÷ × change n, 1..128); ½ ⟳n 2× loop (needs a BPM: ID3 TBPM tag on local files, else NO BPM). MIX tab: EQ HI/MID/LOW, FILTER, CUE (headphone PFL). Header status line → output routing panel.
- Marked PENDING: Beat FX, waveforms (ported by #371), key lock, sync, scratch.

## Library (#372)

Pull-only from the desktop backend (`/api/device-sync/*`, `backend/routers/device_sync.py`); offline after a sync.

- Reachability: desktop Settings › Library › Phone sync (#373) opens an opt-in LAN listener (default port 48127) serving only `/api/device-sync/*`, gated by a pairing code (`X-Manadj-Pair`; `backend/device_listener.py`). Enter `http://<desktop ip>:<port>` + the code in the app. Without it: `adb -s <device> reverse tcp:8127 tcp:<backend port>` and the default URL `http://127.0.0.1:8127` (loopback needs no code). Plain HTTP (`res/xml/network_security_config.xml`).
- SYNC pulls the snapshot (Tracks, Tags, Playlists in Play order, cues, saved grids, Follow evidence edges) and missing preview waveforms (MWF1, by revision). Audio downloads on first load, or all at once via ⚙ → SYNC + ALL AUDIO. Cache: `filesDir/library` (`LibraryStore`).
- `:library` (`dev.manadj.library`, pure Kotlin/JVM): `LibraryRepository` (sync, cache, `audioFile(id)`), `Library` (`query(LibraryQuery)`, `follow(refs, FollowParams, within)`, `marks(deckTrack, id)`, `playlistTracks(id)`, `preview(track)`). Filter semantics mirror the desktop FilterState; Follow ranking ports `frontend/src/follow/matchScore.ts` (Known > Observed > Compatible).
- Load: `app/.../library/LibraryHolder.load` → `PlayerModel.load` (snapshot title/artist, first grid segment, main cue, hot cues; source id `library:<trackId>:<audioRev>`).
- Decoy data for checks: `uv run scripts/android/seed_decoy_library.py http://127.0.0.1:<port> <dir>` against an `--empty-db` lane app.

## Session replay (#378)

Settings › SESSIONS · REPLAY: desktop Sessions replayed on all four decks through the shared engine.

- Data: `GET /api/device-sync/sessions` (headers) and `/sessions/{uuid}` (SessionDetail, `scratchMove` samples dropped), pulled on demand and cached in `filesDir/sessions-cache` (ended Sessions are immutable). Track ids are library ids; audio via the Library download path.
- `:library` `dev.manadj.library.session`: `SessionLog` (streaming parse; desktop `stateAt` reducer with golden parity; `replayAt` = the replay reference: ticks never re-anchor, bend integrates, anchors refined by the ticks that agree after them; `tickDivergence` flags ticks > 5 ms off it), `ReplayScript` (pure: log → ops stamped with Session time; `place` seeds a deck; pre-roll Play at the exact zero crossing), `ReplayEpoch` (one epoch → engine frames), `SyntheticSession` (deterministic test Sessions), `SessionStore`.
- App: `session/ReplayDriver` keeps 2 s of ops frame-stamped in the engine (`AudioEngine.schedule`, tag per epoch; pause/seek cancels), issues loads when due, places a deck at a frame 150 ms ahead once its track is fully decoded. No servo, no correction seeks. `SessionModel` hosts it and logs engine − reference per deck every 2 s (logcat `ManadjSession`, also the SYNC readout). Recorded crossfader folds into the faders (engine crossfader centred, restored on stop); trim/PFL stay the listener's.
- Exactness: native (`EngineTest`: 4-deck randomized replay op set within 1 sample, 10-min beatmatched phase lock), host (`ReplayScriptTest`: script + driver semantics vs `replayAt`), device (`SessionReplayEngineTest`: real engine offline + `ReplayDriver`, ~8.7k checks, worst 0.5 samples = integer-frame op placement).
- Not reproduced (listed on screen): stem mutes, unknown kinds/controls. Scratch replays through the engine scratch path (platter moves from recorded deltas), landing exact. Leaving the screen stops replay.
- Real-data check: `MANADJ_SESSION_DIR=<dir of SessionDetail dumps> ./gradlew :library:test --tests '*RealSessionsTest'`.

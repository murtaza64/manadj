# Mobile device runtime: Capacitor vs PWA vs Tauri mobile (iOS)

Which runtime should host the reused web frontend for the local-first mobile
companion — Capacitor, an installed home-screen PWA, or Tauri mobile (v2)?

Researched 2026-08-25 for #151. Sources are Apple developer docs, WebKit
source (`main`) and webkit.org blog posts, WebKit standards-positions,
capacitorjs.com, and v2.tauri.app. All three options render in WebKit on iOS
(PWA = Safari's WebContent process; Capacitor and Tauri both embed WKWebView),
so every WebCore-level finding below applies to **all three** — the runtimes
differ in what native escape hatches they add.

## Recommendation

**Capacitor.** Background audio and background sync are impossible at the web
layer on iOS in *every* runtime (WebKit interrupts Web Audio on backgrounding
unconditionally, and Background Sync is unimplemented), so the runtime must be
judged on the quality of its native escape hatches — and Capacitor is the only
one with off-the-shelf ones: app-container filesystem with chunked reads and a
`convertFileSrc` fetch path, an official BGTaskScheduler plugin, a mature iOS
plugin ecosystem for the native-audio bridge, and a live-reload dev loop
against the existing Vite server.

## Constraint table

| Constraint | PWA (home screen) | Capacitor | Tauri mobile |
|---|---|---|---|
| Background audio | ❌ Web Audio interrupted; no native escape | ⚠️ Web Audio interrupted; native bridge via plugin works | ⚠️ same; bridge is hand-written Swift |
| Web Audio decode + latency | ⚠️ AudioWorklet ✅; decode memory risk; jetsam opaque | ⚠️ same engine; disk-backed chunked reads help | ⚠️ same engine |
| Multi-GB storage | ⚠️ OPFS quota is ample on paper; evictable, opaque, hard to fill | ✅ app container, no web quota | ✅ app container via fs plugin |
| Background sync | ❌ no Background Sync API; push = visible notifications only | ✅ BGTaskScheduler via official Background Runner (~30 s windows) | ⚠️ BGTaskScheduler only via custom Swift |

---

## 1. Background audio

### What Apple requires of any app

Background/locked-screen playback requires the `audio` value in
`UIBackgroundModes` **and** an `AVAudioSession` with category `.playback`;
the default session behavior is explicit that a "Locked device in iOS
silences app audio" ([Configuring your app for media
playback](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback),
[Configuring background execution
modes](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)).

### What WebKit does — Web Audio is interrupted on backgrounding, period

This is decided inside WebCore, so it binds Safari, home-screen PWAs, and
WKWebView embedders (Capacitor, Tauri) identically:

- `MediaSessionManageriOS::resetRestrictions()` unconditionally (non-Catalyst
  iOS) adds `BackgroundProcessPlaybackRestricted` to media types `WebAudio`,
  `Video`, and `VideoAudio` — but **not** to `Audio` (audio-only
  HTMLMediaElement)
  ([MediaSessionManagerIOS.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm)).
- `MediaSessionManagerInterface::applicationDidEnterBackground()` calls
  `beginInterruption(EnteringBackground)` on every session whose type carries
  that restriction
  ([MediaSessionManagerInterface.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/MediaSessionManagerInterface.cpp)).
- Category selection: when only Web Audio is rendering, WebKit sets the shared
  AVAudioSession category to **`AmbientSound`** (silenced by the ringer
  switch, never background-eligible). It only escalates to `MediaPlayback`
  when an *audible HTMLMediaElement* is playing
  (`MediaSessionManagerCocoa::updateSessionState()`,
  [MediaSessionManagerCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm)).

Consequences:

- **An AudioContext/AudioWorklet graph stops when the app is backgrounded or
  the screen locks, in all three runtimes.** No WKWebView configuration flag
  overrides the restriction — it is compiled into WebCore.
- **`<audio>` element playback survives backgrounding** (media type `Audio`
  has no background restriction, and audible element playback drives the
  `MediaPlayback` category), provided the host app has the `audio` background
  mode. In Safari/PWA the "host app" is Safari, which has it — this is why
  plain `<audio>` streaming keeps playing from a web page but Web Audio does
  not.
- The obvious hybrid — Web Audio graph → `MediaStreamAudioDestinationNode` →
  `<audio srcObject>` (manadj already uses this shape for the cue bus, ADR
  0017) — does **not** clearly escape the restriction, because the feeding
  AudioContext is itself a `WebAudio`-type session and gets interrupted on
  backgrounding regardless of the element downstream. Unverified whether any
  ordering tricks keep it alive; treat as a spike, not a plan.

### Practical shape per runtime

- **PWA**: no escape. Background/lock-screen playback of the Web Audio engine
  is off the table. Only plain `<audio src=…>` streaming would background,
  which forfeits the deck/worklet engine entirely.
- **Capacitor**: set the `audio` background mode in Xcode; do *foreground*
  playback through the existing Web Audio engine, and hand off
  background/locked playback to a native player (AVPlayer/AVAudioEngine)
  via a plugin (community `@capacitor-community/native-audio` or a small
  bespoke Swift plugin — Capacitor plugins are plain Swift classes). Given no
  live DJing on mobile, "background = simple single-track/set continuation via
  native player, foreground = full engine" is a coherent posture.
- **Tauri mobile**: identical WKWebView constraints; the bridge would be a
  custom Swift mobile-plugin (supported:
  [Mobile Plugin Development](https://v2.tauri.app/develop/plugins/develop-mobile/))
  — nothing off the shelf.

### Lock screen / Now Playing

- Web layer: the MediaSession API is supported since Safari 15
  ([Safari 15 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-15-release-notes):
  "Added support for the MediaSession API"), and WebCore feeds a
  NowPlayingManager that backs the system Now Playing surface
  ([MediaSessionManagerCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm)).
  This works for element-driven playback; it does not resurrect Web Audio in
  background.
- Native bridge (Capacitor/Tauri): [`MPNowPlayingInfoCenter`](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter)
  + [`MPRemoteCommandCenter`](https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter)
  give full lock-screen metadata and transport controls for a native player.

---

## 2. Web Audio decode + latency

Same WebKit engine everywhere; differences are only in how the bytes reach
`decodeAudioData` and how much headroom the process has.

- **AudioWorklet**: supported since Safari 14.1 / iOS 14.5 — "available
  unprefixed with support for advanced audio processing via Audio Worklets"
  ([New WebKit Features in Safari 14.1](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)).
  The dual-mode playback worklet (ADR 0018) is portable as-is for foreground
  use.
- **Decode memory math** (arithmetic, no citation): decodeAudioData yields
  float32 PCM — a 10-minute stereo track at 48 kHz is ~230 MB decoded
  (600 s × 48000 × 2 ch × 4 B); at 44.1 kHz ~212 MB. Two loaded decks ≈
  0.5 GB before app/JS heap. On desktop this is nothing; on iOS it is the
  dominant risk.
- **Memory ceilings**: WebKit's own self-kill thresholds ("Websam") for a
  WebContent process are in
  [MemoryPressureHandler.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WTF/wtf/MemoryPressureHandler.cpp)
  (64-bit active process: 7 GB base; default configuration base threshold
  `min(3 GB, ramSize)`), but the *operative* limit on device is the OS jetsam
  limit on the WebContent/app process, which Apple does not publish —
  **could not verify actual on-device numbers from any primary source**.
  Native code can query its own budget via
  [`os_proc_available_memory`](https://developer.apple.com/documentation/os/os_proc_available_memory());
  web content cannot. Mitigation regardless of runtime: decode one track at a
  time, prefer mp3/AAC copies or segment-wise decode on mobile rather than
  full lossless decode.
- **Sample rate / resampling**: on Cocoa ports the Web Audio destination is
  built as an `AudioDestinationResampler` against
  `AudioSession::singleton().sampleRate()` — i.e. a context whose rate
  differs from the hardware session rate gets a resampler stage
  ([AudioDestinationCocoa.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioDestinationCocoa.cpp)).
  Construct the context without a fixed `sampleRate` (as on desktop — cf.
  `webaudio-setsinkid-latency-glitching.md`). The commonly-cited "iPhone
  hardware runs 48 kHz" is device/route-dependent; **not verified against a
  primary source**.
- **Buffer size**: when any Web Audio session is active, WebKit sets the
  preferred AVAudioSession IO buffer to the render quantum (128 frames)
  (`MediaSessionManagerCocoa::updateSessionState()`), so baseline latency is
  small; irrelevant for playback-only use.
- **Interruptions**: phone calls/Siri interrupt the audio session; WebKit
  ships a subset of the (Apple-edited) [Audio Session Web API](https://www.w3.org/TR/audio-session/)
  since Safari 16.4 ("Added support for a subset of the AudioSession Web
  API", [Safari 16.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes)) —
  `navigator.audioSession` lets the page pick a session type and observe
  interruption state. Plan for explicit resume-on-interruption-end handling.

---

## 3. Multi-GB file storage

### PWA: OPFS + IndexedDB

- OPFS is available since iOS 15.2; `FileSystemSyncAccessHandle` (fast
  sync read/write) is worker-only
  ([The File System API with Origin Private File System](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)).
- Quota (Safari 17+ / iOS 17+): origin quota up to **60% of total disk** in a
  browser app, 15% in other WebKit apps; overall quota 80%/20%. "When a web
  app is running standalone (as Home Screen Web App on iOS) it has the same
  origin quota and overall quota as when it is opened in a browser app"
  ([Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)).
  So a multi-GB library fits *on paper*.
- Eviction: ITP deletes all script-writable storage after 7 days of Safari
  use without interaction — but "Web applications added to the home screen
  are not part of Safari and thus have their own counter of days of use …
  We do not expect the first-party in such a web application to have its
  website data deleted"
  ([Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
  Separately, storage-pressure eviction is least-recently-used per origin
  unless persistent mode is granted; WebKit grants `navigator.storage.persist()`
  "based on heuristics like whether the website is opened as a Home Screen
  Web App" ([Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)).
- Net: installed-PWA storage is *probably* durable, but it is opaque
  (no Files-app visibility, wiped by "Clear website data"), best-effort
  unless persist() is granted, and multi-GB ingest must stream over HTTP into
  OPFS.

### Capacitor: native filesystem

- The official [Filesystem plugin](https://capacitorjs.com/docs/apis/filesystem)
  reads/writes the app container (`Documents`, `Library`, `LibraryNoCloud`,
  `Temporary` on iOS) — normal app storage, **no web quota**. `readFile`
  returns base64 over the bridge; `readFileInChunks` (7.1+) streams chunks;
  the File Transfer plugin downloads straight to disk.
- The web layer plays/decodes native files without bridging bytes through
  base64: `Capacitor.convertFileSrc(uri)` rewrites a device path to a
  WebView-servable URL, fetchable from JS
  ([Capacitor Web API docs](https://capacitorjs.com/docs/core-apis/web)) —
  `fetch(convertFileSrc(uri)) → ArrayBuffer → decodeAudioData`.
- iCloud backup: the app's `Documents` directory is backed up by default;
  exclude the track library via a non-backed-up location
  (`LibraryNoCloud` maps to this) or `isExcludedFromBackup`
  ([Optimizing your app's data for iCloud backup](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup)).

### Tauri mobile: fs plugin

- The [fs plugin](https://v2.tauri.app/plugin/file-system/) supports iOS;
  "Access is restricted to Application folder by default". Rust side can use
  `std::fs` freely; JS side goes through scoped permissions.
- Files reach the webview via the `asset:` custom protocol +
  `convertFileSrc`, gated by `assetProtocol.scope`
  ([Asset protocol scope](https://v2.tauri.app/security/asset-protocol/)).
  Whether the iOS asset protocol serves HTTP Range requests (for `<audio>`
  streaming rather than whole-file fetch) — **not verified**.
- iCloud-backup exclusion flags: no Tauri API; would be Swift/Rust by hand.

---

## 4. Background sync

### PWA

- **Background Sync API / Periodic Background Sync: not available.** WebKit
  has never implemented them; the standards-position request
  ([WebKit/standards-positions#14](https://github.com/WebKit/standards-positions/issues/14),
  open since 2018) carries `concerns: privacy` and `concerns: power` from
  Apple reviewers, and the tracking bug
  ([bugs.webkit.org #182565](https://bugs.webkit.org/show_bug.cgi?id=182565))
  is unresolved. No WebKit position or implementation for *Periodic*
  Background Sync was found at all.
- Push: home-screen web apps get Web Push since iOS 16.4, explicitly for
  user-visible notifications
  ([Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/));
  it is not a silent data-sync wake mechanism.
- Net: a PWA can only sync while open in the foreground.

### Capacitor

- Official [Background Runner plugin](https://capacitorjs.com/docs/apis/background-runner):
  a JS runtime scheduled through **BGTaskScheduler** — requires the
  `Background fetch`/`Background processing` background modes and
  `BGTaskSchedulerPermittedIdentifiers` in Info.plist; each invocation gets
  "approximately up to 30 seconds of runtime", with iOS deciding when/how
  often tasks actually run (plugin docs, matching
  [BGTaskScheduler](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler),
  iOS 13+).
- Push-triggered wake: the `remote-notification` background mode ("push
  notifications as a signal that new content is available to download",
  [background modes table](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes))
  is available since Capacitor owns a real app target.
- Foreground sync against the desktop over LAN/tailnet is unrestricted.

### Tauri mobile

- No background-task plugin exists in the official plugin set (see the
  [plugin list](https://v2.tauri.app/plugin/)). BGTaskScheduler is reachable
  only by writing Swift in the generated Xcode project or a custom mobile
  plugin ([Mobile Plugin Development](https://v2.tauri.app/develop/plugins/develop-mobile/)).
  Foreground sync is unrestricted.

---

## Secondary considerations

- **Distribution**: PWA needs no store — Share → Add to Home Screen (and as
  of Safari 26 on iOS 26, any site can be added as a full web app,
  [WebKit Features in Safari 26.0](https://webkit.org/blog/17170/webkit-features-in-safari-26-0/)).
  Capacitor and Tauri produce Xcode projects: TestFlight/App Store, or direct
  install to your own device with a development certificate (free personal
  team provisioning expires quickly — commonly stated as 7 days, **not
  verified against Apple docs**). Tauri documents App Store submission
  ([App Store](https://v2.tauri.app/distribute/app-store/), [iOS code signing](https://v2.tauri.app/distribute/sign/ios/)).
  For a single-user companion app this is a real ongoing tax for both native
  runtimes.
- **Plugin ecosystems (2026)**: Capacitor's official set covers filesystem,
  file transfer, background runner, push/local notifications, etc., plus a
  large community tier. Tauri mobile has the core plugins on iOS (fs, dialog,
  notifications, upload, biometric, NFC, haptics…) but nothing for background
  tasks or media/Now Playing; mobile is the newer half of Tauri v2 and the
  gaps land exactly on this project's hard requirements (audio bridge,
  background tasks).
- **Dev loop**: Capacitor supports live reload by pointing the app's
  `server.url` at the Vite dev server
  ([Live Reload guide](https://capacitorjs.com/docs/guides/live-reload)).
  Tauri: `tauri ios dev` with `devUrl`/`TAURI_DEV_HOST` for on-device HMR
  ([Develop](https://v2.tauri.app/develop/)). PWA: it's just Safari against
  the dev server. All three debug through Safari Web Inspector.
- **Fit with manadj's stack**: the desktop backend stays on the Mac; mobile is
  a sync client + player over the LAN/tailnet. Capacitor adds only an npm
  dependency and an Xcode project to the existing TypeScript toolchain; Tauri
  adds a Rust workspace the project otherwise doesn't have.

---

## Open questions / risks

- **Does the MediaStream→`<audio>` bridge survive backgrounding?** WebCore
  interrupts the feeding AudioContext (`WebAudio` session type) on
  backgrounding, which should silence the element's stream — but the exact
  interaction (does the interrupted context tear down the MediaStream, or
  keep it alive silent?) needs an on-device spike before committing to the
  native-player bridge scope.
- **Real jetsam headroom for decodeAudioData** of lossless tracks in a
  WKWebView on target hardware — unpublished; needs an on-device probe.
  May force mp3/AAC mobile proxies or segmented decode regardless of runtime.
- **Native audio bridge design**: if background playback uses AVPlayer on
  files while foreground uses the Web Audio engine, seamless handoff
  (position sync, beatgrid-aligned display on return to foreground) is new
  engineering not covered by any runtime.
- **Tauri asset-protocol Range support on iOS** — unverified; affects whether
  `<audio>` can stream large files there without full reads.
- Storage-pressure eviction for an installed PWA is heuristic
  (`persist()` grant not guaranteed); a multi-GB library on a nearly-full
  phone is exactly the case that trips it.

## Claims that could NOT be verified against primary sources

- Actual on-device jetsam memory limits for WKWebView WebContent processes
  (WebKit's in-tree kill thresholds are not the OS limit).
- iPhone hardware output running at 48 kHz (device/route-dependent; no
  authoritative fixed number).
- Whether any workaround keeps an AudioContext rendering in background on iOS
  (WebCore source says no; community workarounds are unvetted).
- Free personal-team provisioning expiry period (7 days is folklore-grade).
- Tauri iOS asset protocol Range-request/streaming behavior.

## Source index

- WebKit source (`main`): `Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm`,
  `…/MediaSessionManagerInterface.cpp`, `…/cocoa/MediaSessionManagerCocoa.mm`,
  `…/cocoa/AudioDestinationCocoa.cpp`, `Source/WTF/wtf/MemoryPressureHandler.cpp`.
- webkit.org: blogs 10218 (ITP 7-day cap + home-screen exemption), 14403
  (storage quota/eviction/persist), 12257 (OPFS), 13878 (Web Push 16.4),
  11648 (Safari 14.1 AudioWorklet), 17170 (Safari 26.0);
  standards-positions #14; bugzilla 182565.
- Apple: Safari 15 / 16.4 release notes; configuring-background-execution-modes;
  configuring-your-app-for-media-playback; BGTaskScheduler;
  optimizing-your-app-s-data-for-icloud-backup; MPNowPlayingInfoCenter /
  MPRemoteCommandCenter; os_proc_available_memory.
- Capacitor: apis/filesystem, apis/background-runner, core-apis/web
  (convertFileSrc), guides/live-reload, docs/config.
- Tauri v2: plugin/file-system, security/asset-protocol, develop/,
  develop/plugins/develop-mobile, distribute/app-store, reference/webview-versions.

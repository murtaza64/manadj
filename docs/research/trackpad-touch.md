# Trackpad Finger Contact

Spike for #358, 2026-10-07. macOS 26, built-in trackpad, Electron 37.10.
Prototype: tmp change in lane `vinyl-357-momentum-358-trackpad-touch-spike`
(never lands): `desktop/trackpad-touch/mt-helper.c`, `desktop/trackpadTouch.js`,
`frontend/src/trackpadTouch/proto.ts`, hook in `DeckKeys.tsx`.

## Recommendation

Ship option (c): a small helper process using the private MultitouchSupport
framework, spawned by the shell, frames over IPC. Behind a Perform setting,
off by default, silently absent when the framework or device is missing.
Use finger contact as the touch edge and finger x position as platter
travel, on the Deck whose jog key (T/Y) is held.

(a) is viable in principle but needs a native-addon toolchain the project
does not have, and is unverified. (b) cannot observe contact.

## 1. Feasibility

| Option | Result |
|---|---|
| (a) Public `NSTouch` indirect touches | Not built. The NSView lives in Electron's process, so it needs a Node native addon (ObjC++, rebuilt per Electron ABI). The addon would set `allowedTouchTypes = .indirect` on the view from `getNativeWindowHandle()` and intercept touches via a local `NSEventMaskGesture` monitor or a swizzle on Chromium's `RenderWidgetHostViewCocoa`. Touches arrive only while the window is key and the cursor is over the view. The repo has no native-module build, prebuild, or signing path today. |
| (b) `NSEvent` global monitor | Not viable. Global monitors only see other apps' events. Pressure events need a physical click (Force Touch stage), so they carry no contact edge. |
| (c) Private MultitouchSupport | **Works.** ~150 lines of C. It `dlopen`s the framework (no SDK stub needed), calls `MTDeviceCreateList`, `MTRegisterContactFrameCallback`, and `MTDeviceStart`, and prints JSON lines. Per finger it gives: id, state (3 make, 4 touching, 5 break), normalized x/y and velocity, size, and the device timestamp. The built-in trackpad is enumerated; Magic Trackpads appear as more devices. The interface is unchanged since ~10.5 and is used by BetterTouchTool and similar tools. Fragility risk: the `MTTouch` struct layout (96 bytes) has no ABI promise. Mitigate with a startup sanity check that falls back to "unavailable". |

Constraints of (c):
- It is system-wide, so the shell forwards frames only while a manadj window has focus.
- macOS still processes the touch. The cursor moves, tap-to-click clicks, two-finger scroll emits wheel events, and 3/4-finger system gestures fire. The prototype swallows wheel events while platter mode is on. Production should run platter mode under pointer lock (T/Y already lock), which pins the cursor and makes clicks inert.
- Permission: no TCC prompt or log entry appeared when the helper started. Frame delivery with a real finger is **not yet verified**. Walkthrough step 3 checks it: HUD `frames` > 0. If it stays 0, Input Monitoring may be required.

## 2. Latency and rate

Pipeline (helper stdout → main → `webContents.send` → renderer). Measured with the helper's synthetic 120 Hz finger, timestamps on a shared wall clock:

| Condition | helper→renderer p50 / p95 / p99 |
|---|---|
| Focused, idle | 0.4 / 5.9 / 17 ms |
| Focused, renderer busy 20 ms of every 50 ms | 0.9 / 20.5 / 22 ms |
| Unfocused, App Nap allowed | 1.7 / 30 / 62 ms |

- The renderer main thread is the bottleneck. Its stalls delay pointer events in exactly the same way, so contact frames are no worse than the current mouse path. Frames carry device timestamps, so motion `dt` comes from the device, not from delivery jitter.
- The shell must hold `powerSaveBlocker('prevent-app-suspension')`. App Nap otherwise batches frames, as the unfocused row shows.
- The real device frame rate is not measured yet; read it from the HUD's `rate`/`interval`. Public reports put it at ~90–125 Hz, at or above Chromium's rAF-aligned `pointermove` under pointer lock.
- If main-thread jank proves audible, frames can bypass the renderer main thread: `MessageChannelMain` → renderer → transfer the port to the audio worklet.

## 3. UX

- **When the trackpad is the platter:** Perform only, setting on, Vinyl on for the Deck, and that Deck's jog key (T/Y) held. Finger contact replaces Shift as the touch edge, and Shift stays the edge for mice. This reuses the existing hold-a-key model and its pointer lock, so normal cursor use is unaffected. The prototype uses a standalone `\` toggle instead, only to keep the spike independent of T/Y.
- **Motion:** finger x is mapped linearly (prototype: 600 pointer-px-equivalents, about 1.2 s of Track per pad width). This is linear like a record, unlike accelerated pointer deltas. While the MT contact source is active, ignore pointer deltas.
- **Second Deck:** split by pad half (left half → left-focused Deck, right half → right-focused), with each finger keeping its Deck until lift. Avoid "two fingers = second Deck": macOS reads two fingers as scroll/zoom, and finger ids reorder.
- **Lift = release:** platter momentum (#357) applies unchanged. The prototype shows coast after a synthetic lift.

## 4. Packaging

- Build the helper on the macOS CI runner (`clang -O2 … -framework CoreFoundation`, arm64) and ship it prebuilt under `Contents/Resources/` next to the backend. Add `trackpadTouch.js` to `SHELL_FILES` in `build_dmg.py`. Never compile at runtime: the prototype's tmpdir build is spike-only, and it would break the code seal.
- Sign the helper with the app identity under the hardened runtime. `dlopen` of a `/System` framework passes library validation (platform binary). Notarization does not check private API use; only App Store review does, and that is irrelevant here.
- Windows (note only, unverified): Precision Touchpad contacts are reachable via Raw Input HID (digitizer page 0x0D, touch pad usage 0x05, `RIDEV_INPUTSINK`) parsed with `HidP_*`. It would be a similar helper. Do not rely on `WM_POINTER`: whether `PT_TOUCHPAD` reaches ordinary windows is unclear.

## Production units to file

1. **Shell: trackpad contact bridge.** Prebuilt MT helper plus `trackpadTouch.js`: spawn, focus gating, App Nap blocker, and fallback when the struct check fails. Preload `manadjTrackpad.onFrame`. CI build, DMG Resources, `SHELL_FILES`.
2. **Perform: trackpad platter.** MT contact as the touch edge and linear x travel for the held T/Y Deck. Pad-half Deck assignment. Pointer deltas suppressed during contact. Settings → Keyboard + mouse toggle plus "travel per pad width". Keyboard-map entry. Tests on a fake frame source.
3. **Verification probe.** Real-device frame rate and latency under load, and the TCC answer, before item 2 lands. This may fold into item 1's Walkthrough.
4. **Idea (not now):** worklet-direct frame path, and the Windows Precision Touchpad helper.

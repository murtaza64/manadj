# Cross-platform: Windows + Linux support for the Packaged app

Investigation for #299. It informs an amendment to ADR 0043, which currently
targets Apple Silicon macOS only. Baseline: main at `txtuv` (2026-10-07), plus
the parked packaging lane (#279/#280/#298). Electron 37 ships Chromium 138.

Decision (Murtaza, 2026-10-07): GO on Windows as the next target. It ships
in the first prerelease marked untested on Windows hardware; hardware testing
(#316) comes later. Linux is deferred (#320/#321 stay untriaged).

## Verdict

- **Windows x64: feasible.** The backend is already nearly portable: a CI
  probe on windows-latest passed 1241 of 1245 tests, the backend booted, and
  all vitest tests passed. The real work is a few backend seams, the Electron
  shell, packaging and signing, plus hardware validation of audio and MIDI.
  Rough cost: 15–20 lane-days plus 2–3 hardware sessions.
- **Linux x64: feasible, but with less value and more risk.** Rekordbox and
  Engine DJ don't run on Linux, so the import-first onboarding loses its main
  source. Chromium's PulseAudio backend reports 2 output channels whatever
  device is selected, which breaks single-device Cue routing (Master on 1-2,
  Cue on 3-4). Rough cost: Windows plus another 7–10 lane-days, with
  open-ended risk on Cue routing.
- **Windows arm64:** blocked. There is no torch, torchaudio, tensorflow or
  essentia build for it (probe).
- **Linux aarch64:** partial. essentia is missing, and demucs's `sphn`
  dependency needs a Rust build.
- **Recommended order:** Windows first (Rekordbox and Engine users live
  there), then Linux. Windows arm64 is out of scope.

## Probes

CI run: https://github.com/murtaza64/manadj/actions/runs/37553588211 (scratch
bookmark `probe/cross-platform-299`, workflow not merged).

### Per-package install, py3.13, each in a fresh venv

| Package | win x64 | win arm64 | linux x64 | linux arm64 | mac arm64 |
|---|---|---|---|---|---|
| essentia | **FAIL** | FAIL | ok | FAIL | ok |
| madmom (git, Cython) | ok (~37 s build) | ok | ok | ok | ok |
| beat-this (git) | ok | FAIL (torch) | ok | ok | ok |
| torch/torchaudio 2.9.1 (PyPI) | ok | FAIL | ok (CUDA, ~3.9 GB) | ok | ok |
| torch/torchaudio, CPU index | ok | FAIL | ok | ok | ok |
| demucs | ok | FAIL | ok | FAIL (sphn needs Rust) | ok |
| pyrekordbox (sqlcipher3-wheels) | ok | ok | ok | ok | ok |
| tensorflow | ok | FAIL | ok | ok | ok |
| beatnet | FAIL* | FAIL | FAIL* | FAIL* | FAIL* |
| librosa, soundfile | ok | ok | ok | ok | ok |

\* beatnet fails only when installed on its own: it resolves PyPI madmom
0.16.1, whose sdist breaks. In-project it uses the git madmom source. Nothing
imports it, and #280 removes it.

The runner images include MSVC, so the madmom result says nothing about end
users. Ship madmom as a CI-built wheel.

### Full suite

| | pytest | backend boot | vitest |
|---|---|---|---|
| macos-latest | 1245 pass | ok | 3745 pass |
| ubuntu-latest | 2 fail | ok | 3745 pass |
| windows-latest | 4 fail (after removing essentia; `uv sync --frozen` fails on essentia) | ok | 3745 pass |

Failures:
- `test_db_backup_explicit_paths` (Linux, Windows): `cp -c` in
  `scripts/agent/db_backup.py` has no fallback. GNU cp prints `invalid option
  -- 'c'`, and Windows has no `cp`.
- `test_relocate_shared_unicode_file_to_unique_ascii_paths` (Linux, Windows):
  APFS treats the NFC and NFD spellings of a filename as the same file; ext4
  and NTFS don't. Library paths written on macOS can therefore miss on other
  OSes, and two rows pointing at one file become two files.
- `test_engine_perf_export_*` ×2 (Windows): `pgrep` is missing.
  `enginedj/track_export.py:51-58` doesn't catch `FileNotFoundError`, so every
  Engine export would return a 500.

## Summary: seam × OS × effort × risk

Effort: S ≤ ½ lane-day, M 1–2, L 3–5. Risk is the chance the estimate breaks
or a hardware surprise turns up.

| Seam | Windows | Linux | Effort W / L | Risk |
|---|---|---|---|---|
| Python deps (essentia, heavyweights, torch index) | essentia blocks sync | CUDA torch bloat | S / S | low |
| madmom wheel build in CI | needs MSVC | needs cc | S / S | low |
| File clones (`cp -c`) | crash (db_backup) / slow copy | crash (db_backup) / full copy | S / S | low |
| Process checks (`pgrep`) | Engine export 500s | no-op | S / S | low |
| Path identity (separators, case, NFC) | exact-match tier dead for Rekordbox | NFC/NFD only | M / S | med |
| Rekordbox write paths (`add_content`) | backslash FolderPath | n/a | S / – | med (unverified in RB) |
| Engine cross-drive + per-drive libraries | `relpath` ValueError; per-drive DBs | n/a | S + L / – | med |
| Stems device (`mps` default) | all splits fail | all splits fail | S / S | low |
| Stems compute (CPU only) | slow; CUDA needs a separate index | same | M / M | med |
| Data root / defaults / discovery | `~/Library` hardcoded | same | S / S | low |
| Open-file deletes (relocate, stems) | PermissionError after commit | ok | M / – | med |
| Keyboard chords + labels | Win+L locks screen | Super grabbed | S / S | low |
| Fonts (UbuntuMono Nerd Font not bundled) | fallback, width drift | same | S / S | low |
| Electron shell chrome | no window controls, mac-only branding | same + ensure-electron breaks `make app` | M / M | low |
| Electron backend supervision (`desktop/backend.js`) | `bin/python3`, SIGTERM | ok | S / S | low |
| Audio: Master+Cue on one 4-out device | depends on endpoint mix format | Pulse reports 2ch | M / L | **high** |
| Audio: Cue to a second device | per-device sink ok | sink-level ok | S / S | med |
| Audio latency | ~10 ms WASAPI shared | ≥512 frames | – / – | med |
| MIDI | WinMM exclusive; MIDIIN2 dup ports | ALSA seq ok | S / S | med |
| Packaging | NSIS 2 GB cap vs 1–3 GB runtime | AppImage sandbox / userns | L / M | med |
| Signing | SmartScreen; Artifact Signing (US/CA individuals) | none | M / – | med |
| Rekordbox / Engine integration | supported | **not available** | – / – | product |
| Dev tooling (Makefile, dev.py, lane_app) | POSIX-only | mostly ok | M / S | low (dev-only) |

## Seams in detail

### Python runtime

- **python-build-standalone 3.13:** available for
  `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`, and x86_64/aarch64
  `unknown-linux-gnu`
  ([release 20261003](https://github.com/astral-sh/python-build-standalone/releases/tag/20261003)).
  The packaging lane already installs straight into the runtime's
  site-packages instead of a venv (`scripts/release/build_dmg.py`
  `build_python_runtime`), which avoids venv relocation. That code hardcodes
  `runtime/"bin"/"python3"` and `lib/python3.13/EXTERNALLY-MANAGED`; on
  Windows the paths are `python.exe` and `Lib\`.
- **essentia:** no Windows wheel and no sdist
  ([PyPI](https://pypi.org/pypi/essentia/json)). The docs say the Python
  bindings are unsupported on Windows
  ([installing](https://essentia.upf.edu/installing.html)). Only `harness/`
  imports it. Fix: move it to a dependency group or put a platform marker on
  it.
- **Heavyweights:** tensorflow, librosa, beatnet and matplotlib are
  unimported, and #280 already drops them. torchaudio 2.9 routes
  `load`/`save` through torchcodec, which needs FFmpeg shared libs
  ([v2.9.0 notes](https://github.com/pytorch/audio/releases/tag/v2.9.0),
  [torchcodec](https://github.com/meta-pytorch/torchcodec#installing-torchcodec)).
  Check whether anything in the app calls torchaudio I/O. If nothing does,
  drop the torchaudio pin.
- **torch on Linux:** the PyPI x86_64 torch is the CUDA build (858 MiB plus
  about 3 GiB of nvidia/triton;
  [PyPI 2.9.1](https://pypi.org/pypi/torch/2.9.1/json)). Use a marker-scoped
  uv index pointing at `https://download.pytorch.org/whl/cpu`. The PyPI
  Windows torch is already CPU-only.
- **madmom:** no wheels, last PyPI release 2018, upstream CI is Linux-only
  up to py3.12 ([ci.yml](https://github.com/CPJKU/madmom/blob/main/.github/workflows/ci.yml),
  [#158](https://github.com/CPJKU/madmom/issues/158)). It builds from git on
  all five runners. Build one wheel per platform in release CI.
- **pyrekordbox:** uses `sqlcipher3-wheels`, which has wheels on every target.
  The DB key is OS-independent
  ([masterdb/database.py](https://github.com/dylanljones/pyrekordbox/blob/main/pyrekordbox/masterdb/database.py)).
- **ffmpeg:** BtbN builds cover win64, winarm64, linux64 and linuxarm64,
  each as gpl/lgpl × static/shared
  ([FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds#targets-variants-and-addins)).
  Use LGPL: losing x264/x265 doesn't matter for audio
  ([legal](https://ffmpeg.org/legal.html)). On macOS the packaging lane uses
  martin-riedl.de arm64 builds.
- **slskd:** release binaries exist for win-x64, win-arm64, linux-x64 and
  linux-arm64 ([0.26.0](https://github.com/slskd/slskd/releases/tag/0.26.0)).

### Stems

- `backend/config.py:58` defaults `device = "mps"`, and
  `backend/stems.py:142-150` passes `-d mps` to demucs, so every split fails
  off macOS. Fix: an `auto` default that resolves cuda → mps → cpu, the same
  order as demucs's own default.
- On Windows there's no GPU path beyond CUDA: torch-directml pins torch 2.4.1
  ([PyPI](https://pypi.org/pypi/torch-directml/json)). CPU splitting is
  probably several times slower than MPS (`docs/research/stem-splitting-model-benchmark.md`
  has MPS numbers only), so measure it. An NVIDIA build means shipping CUDA
  torch (multi-GB); leave it as an opt-in download, not the default bundle.

### Filesystem and path identity

- **Matching:** `backend/sync_common/matching.py:44-62` (`TrackIndex`) tries a
  case-sensitive exact full-path match, then falls back to the basename. The
  same pattern is in `backend/sync_status/aggregator.py:299,320` and
  `rekordbox/perf_export.py:100-114`.
  - Rekordbox stores `C:/…` with forward slashes (pyrekordbox
    `masterdb/database.py` ~L2138-2167, "the database and ANLZ files use "/"
    as path delimiter"). manadj on Windows stores `str(Path.resolve())`, i.e.
    `C:\…` (`backend/library/scanner.py:25-32`,
    `backend/library/import_manager.py:93,128,171`).
  - So the exact tier never fires, and duplicate basenames become ambiguous
    or wrong. Drive-letter case and NFC/NFD (see probe) cause the same miss.
  - Fix: one `path_key()` that converts `\`→`/`, casefolds on Windows and
    NFC-normalizes, used by every index. The matching contract in CONTEXT.md
    changes.
- **Rekordbox writes:** `backend/tracks/executor.py:139` and
  `rekordbox/sync.py:83` pass `str(file_path.absolute())` to `add_content`,
  which on Windows writes backslash FolderPaths. Pass `.as_posix()`.
  `executor.py:200` stores FolderPath verbatim on import; store the
  native-separator form there instead.
- **Engine:**
  - `enginedj/track_export.py:126` calls `os.path.relpath`, which raises
    `ValueError` when the track and the Engine Library are on different
    drives.
  - Engine keeps a separate `Engine Library` at the root of each drive that
    holds music
    ([staff post](https://community.enginedj.com/t/engine-dj-problems-with-windows-11/70781/7);
    [User Guide v5.1](https://cdn.inmusicbrands.com/engine/51/Engine%20DJ%20-%20User%20Guide%20-%20v5.1.0.pdf)
    p.17). manadj models a single `engine_dj_path`.
  - The same gap exists on macOS for external volumes (today it writes a
    `../../Volumes/…` path into the main DB), so this is not purely a Windows
    issue.
  - Fix: guard the cross-drive case now (S). Multi-drive support is L.
- **Clones:** APFS `cp -c` / `cp -Rc` appears in `scripts/agent/db_backup.py`
  (no fallback, which crashes, as the probe shows),
  `enginedj/track_export.py:76-83`, `rekordbox/perf_export.py:60-74` (falls
  back to `copytree`, so a full copy) and `scripts/agent/lane_app.py:155,163`.
  Fix: one `clone_file` / `clone_tree` helper — `cp -c` on macOS,
  `cp --reflink=auto` on Linux, plain copy on Windows.
- **Open-file deletes (Windows):** `backend/routers/tracks.py:153-156`
  (relocate) commits the DB, then calls `unlink`. `backend/stems.py:204-207`
  calls `rmtree`, then moves. Windows refuses to delete files that are open
  (for example while being streamed), which leaves the DB and disk out of
  step. Fix: retry/defer, or reorder so the commit happens after the file
  operation.
- **Text encoding:** `read_text()` / `open()` without `encoding=` uses cp1252
  on Windows (`backend/config.py:95`, `backend/stems.py:86,201`,
  `backend/routers/visualizer_ga.py`). Pass `encoding="utf-8"`, or set
  `PYTHONUTF8=1` in the shell.
- **Scanner:** the extension glob is case-sensitive on Linux, so `.MP3` files
  are skipped (`backend/library/scanner.py:25-32`).
- **Frontend:** `filename.split('/').pop()` shows the full path on Windows
  (`frontend/src/components/TrackRow.tsx:148`, `TagEditor.tsx:225`).
  `Acquisition.tsx:568` already handles `\`.
- **Data root:** `backend/data_root.py:27` hardcodes
  `~/Library/Application Support/manaDJ`. Use `%APPDATA%\manaDJ` on Windows
  and `$XDG_DATA_HOME/manaDJ` on Linux, or let the shell pass
  `app.getPath("userData")` through `MANADJ_DATA_DIR`. `desktop/main.js`
  uses `app.getPath("logs")`, which is already portable.
- **Defaults and discovery:**
  - The committed `config.toml:5,8,12` contains `/Users/murtaza` paths.
  - Rekordbox lives at `%APPDATA%\Pioneer\rekordbox`
    ([FAQ](https://rekordbox.com/en/support/faq/installation-5/#faq-q500101)).
    pyrekordbox discovers it, but raises an uncaught `AssertionError` on
    mismatched options.json (`pyrekordbox/config.py` L322-346).
  - Engine lives at `%USERPROFILE%\Music\Engine Library\Database2`.
  - A hand-written TOML Windows path like `"C:\Users\…"` crashes `tomllib`
    with an invalid `\U` escape, so Settings must write paths itself.
- No file-reveal feature exists yet. When one is built, use Electron's
  `shell.showItemInFolder`.

### External libraries

| | Windows | Linux |
|---|---|---|
| Rekordbox | supported ([system reqs](https://rekordbox.com/en/download/)) | not available; pyrekordbox returns `Path()` |
| Engine DJ Desktop | supported (`Engine DJ.exe`) | not available ([downloads](https://enginedj.com/downloads/)) |
| Running check | psutil, as `rekordbox/perf_export.py:46-52` already does for Rekordbox | same |

- Replace `pgrep -f "Engine DJ\.app/…"` (`enginedj/track_export.py:44,52`)
  with a psutil name check.
- Linux product consequence: the Import side of onboarding (#274, Rekordbox
  import first-run) only works if the user copies `master.db` over from
  another machine. Opening a copied DB by explicit path should work, since
  wheels exist, but this is untested.

### Audio

Chromium source refs are at tag `138.0.7204.183`.

- **Windows:**
  - `destination.maxChannelCount` comes from the endpoint's shared-mode mix
    format
    ([renderer_webaudiodevice_impl.cc#L365](https://github.com/chromium/chromium/blob/138.0.7204.183/content/renderer/media/renderer_webaudiodevice_impl.cc#L365),
    [core_audio_util_win.cc#L503](https://github.com/chromium/chromium/blob/138.0.7204.183/media/audio/win/core_audio_util_win.cc#L503)).
  - It is queried per device, so after `setSinkId` it should reflect the
    chosen device
    ([audio_manager_win.cc#L353](https://github.com/chromium/chromium/blob/138.0.7204.183/media/audio/win/audio_manager_win.cc#L353)).
  - A 4-out controller exposed as a single 4-channel endpoint configured as
    stereo reports 2. The user may need to set Speaker Setup to Quadraphonic.
    If the vendor driver exposes two stereo endpoints instead, the existing
    cross-device MediaStream bridge (ADR 0017) covers Cue.
  - There's no ASIO in Chromium
    ([media/audio](https://github.com/chromium/chromium/tree/138.0.7204.183/media/audio)).
  - `interactive` latency is the WASAPI default engine period, about 10 ms
    ([MS docs](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio)).
- **Linux:**
  - The Pulse backend ignores `output_device_id` and takes channels from the
    server default sample spec
    ([audio_manager_pulse.cc#L220,#L354](https://github.com/chromium/chromium/blob/138.0.7204.183/media/audio/pulse/audio_manager_pulse.cc#L354)),
    so expect `maxChannelCount = 2`. The ALSA fallback is always stereo.
  - `setSinkId` still works at the stream level. A workable path is to split
    the 4-channel sink into two stereo virtual sinks with PipeWire
    `module-loopback`
    ([docs](https://docs.pipewire.org/page_module_loopback.html)) and route
    Cue through the cross-device bridge. That requires user setup or a
    helper. The minimum output buffer is 512 frames
    ([#L36](https://github.com/chromium/chromium/blob/138.0.7204.183/media/audio/pulse/audio_manager_pulse.cc#L36)).
- **Device-label matching:** `frontend/src/playback/audioDeviceMapping.ts`
  matches lower-cased substrings, which survive WASAPI labels like
  `Speakers (DDJ-GRV6)`. `verifiedRouteDefaults` assumes one 4-channel
  device, so it needs per-OS verification.
- **GRV6 channel-label fix:** `desktop/main.js:219-239` plus
  `desktop/assert-channel-labels.swift` are CoreAudio-only and correctly gated
  on darwin. Whether the GRV6 has the same problem on Windows is unknown.

### MIDI

- **Windows:**
  - Chromium uses WinMM; WinRT is disabled by default
    ([midi_switches.cc](https://github.com/chromium/chromium/blob/138.0.7204.183/media/midi/midi_switches.cc)).
  - On Windows 10, legacy ports are exclusive. If Rekordbox holds the
    controller, Chromium shows the port as disconnected and raises no error
    ([midi_manager_win.cc#L437](https://github.com/chromium/chromium/blob/138.0.7204.183/media/midi/midi_manager_win.cc#L437)).
  - Windows 11 with Windows MIDI Services makes ports multi-client
    ([microsoft.github.io/MIDI](https://microsoft.github.io/MIDI/)).
- **Port names:**
  - Windows legacy names are 31-character `szPname`. Later ports are named
    `MIDIIN2 (Device)`, and a second identical unit gets a `2- ` prefix
    ([port names KB](https://github.com/microsoft/MIDI/blob/main/docs/kb/how-midi1-port-names-are-generated.md)).
  - `frontend/src/midi/adapter.ts:62,91` attaches every port whose name
    contains the match string, so multi-port devices would get duplicate
    decoders and LED sends. Fix: dedupe, or choose a primary port.
- **Linux:** the ALSA sequencer is multi-client, and USB port names are
  `"<card> MIDI <n>"`
  ([midi_manager_alsa.cc](https://github.com/chromium/chromium/blob/138.0.7204.183/media/midi/midi_manager_alsa.cc#L1172),
  [sound/usb/midi.c](https://github.com/torvalds/linux/blob/master/sound/usb/midi.c)).
- SysEx isn't used: `requestMIDIAccess()` is called without it
  (`adapter.ts:219`).

### Desktop shell and packaging

- **Window chrome:** `desktop/main.js` uses `titleBarStyle: "hidden"` with
  `trafficLightPosition` and no `titleBarOverlay`. On Windows and Linux that
  leaves no window controls
  ([custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)).
  `frontend/src/components/TopBar.css:58-61` reserves 84 px for the traffic
  lights.
- **Branding:** `app.dock` is macOS-only, and Windows/Linux need a window
  `icon`. No `Menu` is set, so the default menu's accelerators stay live.
- **`desktop/ensure-electron.sh`:** uses PlistBuddy, codesign, ditto and the
  `darwin-arm64` zip. On Linux, `make app` exits there. It's dev-only; gate it
  on `uname`.
- **`desktop/backend.js` (packaging lane):**
  - Spawns `<resources>/python/bin/python3`; on Windows it's `python.exe`.
  - Stops the backend with SIGTERM, then SIGKILL. On Windows, `kill()` is
    TerminateProcess, so uvicorn gets no graceful shutdown.
  - Use a shutdown endpoint, or `taskkill /T`. The managed slskd needs the
    same treatment.
- **Windows installer:**
  - NSIS has a 2 GB cap ([NSIS](https://nsis.sourceforge.io/Features)), and
    electron-builder has failed at 1.8 GB
    ([#7705](https://github.com/electron-userland/electron-builder/issues/7705)).
  - With torch, the runtime lands at 1–3 GB. Options are `nsis-web`, or
    downloading the runtime or stems on first run.
  - electron-updater supports NSIS
    ([auto-update](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)).
  - The macOS lane deliberately avoids electron-builder (prebuilt
    Electron.app + ditto). Windows probably wants electron-builder, or a
    zip/portable artifact first.
- **Windows signing:**
  - Unsigned apps get the SmartScreen "Run anyway" prompt, and Smart App
    Control on Windows 11 can block them outright
    ([reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
  - Artifact Signing (formerly Trusted Signing) costs $9.99/mo; public-trust
    certificates for individuals are US/CA only
    ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).
  - EV certificates no longer bypass SmartScreen instantly.
- **Linux installer:**
  - AppImage: electron-builder's runtime doesn't need FUSE2.
  - On Ubuntu 24.04, AppArmor restricts unprivileged user namespaces, so an
    AppImage needs `--no-sandbox` or a profile
    ([electron#42510](https://github.com/electron/electron/issues/42510),
    [Ubuntu](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)).
  - deb installs an AppArmor profile
    ([after-install.tpl](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/linux/after-install.tpl)).
  - Flatpak needs `--socket=pulseaudio` and explicit filesystem grants for
    music libraries
    ([permissions](https://docs.flatpak.org/en/latest/sandbox-permissions.html)).
- **Wayland:** Electron 37 still defaults to X11/XWayland; Electron 38
  switches to native Wayland
  ([breaking changes](https://github.com/electron/electron/blob/main/docs/breaking-changes.md)).

### Keyboard and fonts

- **Meta-only chords:** `frontend/src/components/performance/DeckKeys.tsx:235`
  requires `metaKey && !ctrlKey` for the `a s g l ; h` chords
  (`performanceKeys.ts:109-123`). On Windows that is Win+key, and Win+L locks
  the screen. On Linux, Super is grabbed by the desktop. Fix: use a
  platform-aware primary modifier.
- **Labels:** "⌘" / "Cmd" labels in `DeckPanel.tsx:689-692,763-764,1073,1085`
  and `RoutineEditorView.tsx:1673,1681`. Everything else already accepts
  `metaKey || ctrlKey`.
- **Fonts:** `'UbuntuMono Nerd Font'` (`frontend/src/styles/base.css:14`,
  `frontend/src/theme/tokens.ts:107`) has no `@font-face`, so it only renders
  where it is installed locally. Bundle it, which affects macOS outside users
  too. `-apple-system` falls back to a generic font, which is fine.

### Dev tooling (Windows-only concern, low priority)

- `scripts/dev.py` spawns `npm` without `.cmd` and terminates only the direct
  child.
- `scripts/agent/lane_app.py` hardcodes `/Users/murtaza`, uses `.venv/bin`,
  and relies on `os.killpg`, `start_new_session`, and `os.kill(pid, 0)`. On
  Windows, `os.kill(pid, 0)` kills the process.
- Lane tooling stays macOS-only. A Windows contributor would use plain `uv
  run uvicorn` plus `npm run dev`.

## Hardware tests (need a Windows box / Linux box + controller)

- **W-AUDIO-1:** for FLX4/SB3/GRV6/Inpulse with the vendor driver and the
  class driver:
  - one 4-channel endpoint or two stereo endpoints?
  - `maxChannelCount` with the default format, then with Quadraphonic;
  - does Cue reach outputs 3-4?
  - bridge latency.
- **L-AUDIO-1:** on PipeWire and on PulseAudio:
  - `maxChannelCount` per profile;
  - two loopback sinks plus `setSinkId` routing.
- **W-MIDI-1:**
  - port names on Windows 10 and on Windows 11 with MIDI Services;
  - behaviour with Rekordbox open;
  - hot-plug;
  - LED feedback.
- **L-MIDI-1:** port names and hot-plug, native and in Flatpak.
- **RB-WIN-1:**
  - does Rekordbox accept a backslash FolderPath written by pyrekordbox?
  - drive-letter case in real `master.db` rows.
- **PKG-1:** NSIS vs `nsis-web` with the real runtime size; AppImage and deb
  launching on a fresh Ubuntu 24.04.

## Recommended order

1. Make the backend portable. All of this can be verified in CI with no
   hardware: dependency hygiene, a clone helper, psutil process checks,
   path identity, Engine cross-drive guard, stems `auto` device, per-OS
   data root and discovery, Windows open-file handling, UTF-8 I/O. Gate it
   with a Windows + Linux CI matrix (needs approval to merge CI).
2. Frontend and shell: keyboard modifier and labels, bundled font, window
   chrome and icon, backend supervision on Windows, MIDI port dedupe.
3. Windows hardware session: W-AUDIO-1, W-MIDI-1, RB-WIN-1, then fixes and a
   Windows audio setup guide.
4. Windows packaging (runtime, ffmpeg, slskd, madmom wheel, installer
   format), then a signing decision. Amend ADR 0043.
5. Linux: L-AUDIO-1 decides whether single-device Cue routing is viable,
   then AppImage/deb packaging. Product decision first: Linux without
   Rekordbox/Engine import.

## Overall estimate

- Steps 1–2: about 8–10 lane-days, mostly S/M.
- Windows hardware fixes: 2–4 lane-days plus sessions.
- Windows packaging and signing: 4–6 lane-days.
- Linux on top: 7–10 lane-days, with Cue routing as the open-ended risk.
- Windows arm64: not until torch/torchaudio ship win_arm64.

## Proposed issues (filed untriaged, `feature:cross-platform`)

| # | Title | Effort |
|---|---|---|
| #302 | dependency hygiene for Windows/Linux installs | S |
| #303 | portable file-clone helper (replace cp -c) | S |
| #304 | psutil process checks for Engine DJ | S |
| #305 | path identity key for Track matching (separators, case, NFC) | M |
| #306 | Engine export cross-drive guard | S |
| #307 | Engine per-drive libraries | L |
| #308 | stems device auto (cuda/mps/cpu) + CPU timing | S |
| #309 | per-OS data root and External library path discovery | S |
| #310 | Windows open-file deletes and UTF-8 file I/O | M |
| #311 | platform-aware keyboard modifier and labels | S |
| #312 | bundle the UbuntuMono Nerd Font | S |
| #313 | Electron shell chrome on Windows/Linux | M |
| #314 | Electron backend supervision on Windows (blocked by #279) | S |
| #315 | MIDI multi-port dedupe and exclusive-access surfacing (blocked by #316) | S |
| #316 | Windows hardware validation session | M + human |
| #317 | Windows packaging (blocked by #302, #314, #280) | L |
| #318 | Windows code-signing decision | human |
| #319 | Windows + Linux CI matrix (needs approval) | S |
| #320 | Linux Cue routing on PulseAudio/PipeWire | L |
| #321 | Linux packaging (blocked by #320) | M |

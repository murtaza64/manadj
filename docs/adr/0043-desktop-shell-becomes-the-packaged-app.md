# The Desktop shell becomes the packaged app

Status: accepted 2026-10-06 (onboarding for outside users). Supersedes the
"not a distributable" stance of desktop-shell/01 and `desktop/README.md`.

- Target: Apple Silicon macOS only. Unnotarized DMG on GitHub Releases
  (`murtaza64/manadj`, public); ad-hoc signed, users right-click → Open once.
  Notarization deferred.
- Electron owns the backend in the packaged app: it spawns and supervises
  uvicorn from a bundled python-build-standalone runtime with a prebuilt venv
  and a bundled ffmpeg. The backend serves the built frontend (SPA fallback)
  on `127.0.0.1` — a secure-context `http://localhost` origin, never `file://`
  (Web MIDI, AudioWorklet). Dev keeps attach-only (`make dev` / `make app`).
- PyInstaller/Nuitka rejected: madmom (Cython, git build) and torch are
  fragile under freezing; a relocatable real interpreter + venv runs the same
  code path as dev.
- Stems ship (demucs + torch in the bundle). Large-library cost is handled by
  UX (no stem enqueue on bulk import; a later opt-in stems onboarding flow),
  not by dropping the feature. Unimported heavyweights (tensorflow, librosa,
  beatnet, matplotlib) are removed from the base install.
- All mutable state lives under one data root: packaged =
  `~/Library/Application Support/manaDJ`; dev = the repo (`data/`,
  `config.toml`), selectable via `MANADJ_DATA_DIR`. App configuration
  formerly in `config.toml` is edited in Settings but persisted as a
  human-readable TOML file in the data root, revealable from Settings.
- Export to External libraries is off by default (Settings toggle); outside
  users get Import only until they opt in.

## Amendment 2026-10-07: Windows x64 (cross-platform #299, #317)

- Targets: Apple Silicon macOS **and Windows x64**. The Windows build ships
  in prereleases and v0.1.0 marked **untested on Windows hardware** until
  the hardware session (#316). Linux stays deferred (#320/#321); Windows
  arm64 is out of scope (no torch/essentia builds).
- Same architecture as macOS: Electron owns a bundled python-build-standalone
  3.13 runtime (x86_64-pc-windows-msvc, deps installed in-place) plus a
  bundled ffmpeg (BtbN LGPL win64 static); the backend serves the built
  frontend on `127.0.0.1`. Data root `%APPDATA%\manaDJ`.
- Built on GitHub Actions `windows-latest` (madmom compiles there with MSVC)
  from the same commit as the DMG; `scripts/release/release.py` attaches
  both artifacts to one GitHub Release.
- Installer: Inno Setup, per-user (no admin), `%LOCALAPPDATA%\Programs\manaDJ`;
  NSIS was ruled out by its 2 GB cap against a 1–3 GB runtime. Unsigned:
  users click through SmartScreen; signing is a separate decision (#318).
- Backend supervision is OS-neutral (#314): a token-guarded shutdown hook
  replaces signal-only stops (Windows `kill()` is TerminateProcess), with a
  process-tree kill fallback and a stdin lifeline against orphans.

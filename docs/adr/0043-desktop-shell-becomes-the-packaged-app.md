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

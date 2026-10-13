# PRD: Packaged app

Feature slug: `packaged-app`. Decided 2026-10-06; ADR 0043.

## Problem Statement

manadj only runs from a dev checkout: attach-only Electron, Vite dev server,
DB/config/stems inside the repo, hard-coded `/Users/murtaza` paths, ffmpeg
required on PATH (backend dies without it), dev-only surfaces exposed,
configuration only via `config.toml`.

## Solution

A DMG for Apple Silicon macOS on GitHub Releases. Electron spawns a bundled
backend that serves the built frontend. All state in a per-user data root.
App configuration edited in Settings, persisted as a human-readable file.
Rough edges for non-technical users removed.

## User Stories

1. I download a DMG, drag manaDJ to Applications, right-click → Open, and it
   runs with no Terminal, Python, Node or Homebrew.
2. My library, settings, logs, backups and stems live in
   `~/Library/Application Support/manaDJ`.
3. Settings has a Library section: tracks directory (folder picker),
   Rekordbox location, Engine DJ location, Export enabled toggle, and a
   "Reveal settings file" / "Reveal logs" action.
4. Editing the settings file by hand is equivalent to editing in Settings.
5. Export to Rekordbox/Engine is hidden until I enable it in Settings.
6. If something fails at startup I see an error in the window, not an
   endless splash.
7. I never see dev tools: MIDI inspector, visualizer arena, PAIR editor, perf
   hook, the `swift` channel-label script, `make dev` hints.
8. The backend is not reachable from my network.
9. Stems work in the packaged app.
10. Murtaza can cut a release with one command.

## Implementation Decisions

- Data root: `MANADJ_DATA_DIR`; packaged default
  `~/Library/Application Support/manaDJ`, dev default the repo. Used by
  `backend/database.py`, `config.py` (settings file, `.env`, stems dir),
  `db_backup.py` (backups everywhere, not only `REAL_DB`), Electron window
  state, logs. `MANADJ_DB_URL` must govern app and alembic alike.
- Settings file: TOML in the data root (dev: repo `config.toml`), read/written
  by a backend settings module with a UI in Settings; all user-facing errors
  stop referring to `config.toml` editing. UI preferences stay in the DB
  `settings` table.
- Backend logs to a rotating file in the data root plus stdout.
- `ensure_ffmpeg` non-fatal: surfaced as a UI error state; packaged app
  bundles ffmpeg and puts it on PATH for the backend.
- Bind `127.0.0.1`.
- Dev gating: one flag (dev build / `MANADJ_DEV=1`) for dev-only surfaces.
- FastAPI serves `frontend/dist` with SPA fallback; frontend uses same-origin
  API when served by the backend (no baked `VITE_API_URL`).
- Electron (packaged): pick a free port, spawn backend, wait for health,
  load it; stop backend on quit; show startup errors.
- Bundle: python-build-standalone 3.13 + prebuilt venv (incl. madmom, demucs,
  torch), ffmpeg arm64 static, built frontend, electron-builder (or forge)
  DMG, ad-hoc signed. Remove tensorflow/librosa/beatnet/matplotlib from the
  default install. `scripts/release/` builds and uploads to GitHub Releases.
- Stems: shipped; no stem enqueue on bulk imports; startup sweep keeps its
  backlog guard. A one-time stems onboarding flow is a later issue.

## Testing Decisions

Backend tests for data-root resolution and settings-file round trip. Build
the DMG and launch it on a clean user account / fresh data root as the
acceptance check.

## Out of Scope

Notarization, auto-update, Windows/Intel, stems onboarding flow, moving UI
preferences out of the DB.

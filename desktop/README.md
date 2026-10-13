# manadj Desktop shell

Electron window around manadj, in two modes (packaged-app #279, ADR 0043):

- **attach** (dev, default): window around an already-running manadj. Owns
  no processes or state — `make dev` still runs the backend and Vite; this
  is just the window (dock icon, no MIDI prompts, no background throttling).
- **managed** (packaged builds, or `--managed`): the shell owns the backend.
  It picks a free port, spawns uvicorn (`backend.js`), waits for health,
  loads it (the backend serves `frontend/dist` — `backend/spa.py`), and
  stops it on quit. Startup failures render an error page with a log tail,
  never an endless splash.

## Usage

    make dev-app          # backend + frontend + shell in one command;
                          # Cmd+Q shuts everything down
    make app              # window only — attaches to http://localhost:5173
    make app PORT=5193    # attaches to a lane's Vite port
    npx electron . --url http://localhost:5193   # arbitrary URL

Managed mode (the packaged app's flow, runnable from a checkout — needs a
built `frontend/dist`):

    cd frontend && npm run build
    cd desktop && npx electron . --managed

Managed-mode resolution, overridable via env (packaged defaults in
`backend.js`): `MANADJ_PYTHON` (default `.venv/bin/python3`; packaged
`<resources>/python/bin/python3`), `MANADJ_BACKEND_ROOT` (repo-shaped tree;
packaged `<resources>/backend`), `MANADJ_DATA_DIR` (packaged default
`~/Library/Application Support/manaDJ`, exported to the backend),
`MANADJ_FFMPEG_DIR` (prepended to PATH). The backend binds `127.0.0.1` on a
free port; the shell captures its stdout/stderr to
`<data root>/logs/shell-backend.log` (no data root:
`~/Library/Logs/manaDJ/shell-backend.log`). Packaged builds also set
`MANADJ_PACKAGED=1` (`backend/data_root.py`).

Profiling:

    MANADJ_REMOTE_DEBUG=1 make dev-app
    MANADJ_REMOTE_DEBUG=1 MANADJ_REMOTE_DEBUG_PORT=9223 make app
    npx electron . --remote-debug --remote-debug-port 9223

Open `http://127.0.0.1:9222/json` (or the chosen port) to attach Chrome
DevTools Protocol clients. The renderer also exposes:

    window.__MANADJ_PERF__.markIdleScenario('editor idle')
    window.__MANADJ_PERF__.getFrameCounters()
    window.__MANADJ_PERF__.resetFrameCounters()

If nothing is running at the target, the shell shows a retry page and
auto-loads once the server comes up. `make dev-app` is orchestration in
`scripts/dev.py`, not in the shell — the shell itself stays attach-only.

Live reload: the window renders the Vite dev server, so frontend HMR and
`uvicorn --reload` work as in a browser. Changes to `main.js` itself require
relaunching the shell (rare; no electronmon dependency on purpose).

Renderer console (`console.*` in the frontend) is forwarded to stdout as
`[browser] ...` lines; `make dev-app` gives them their own label in the
multiplexed stream. DevTools (Cmd+Option+I) remains the richer surface.

Everything is also teed to `~/Library/Logs/manaDJ/renderer.log` (timestamped,
pid-tagged, 5 MB startup rotation) along with crash signals —
render-process-gone, child-process-gone (GPU death), unresponsive,
did-fail-load, GPU feature status, clean-quit marker — so blank-screen
incidents leave evidence even in attach mode (stability #188).

## Behavior

- `backgroundThrottling: false` — rAF/timers keep running while occluded;
  otherwise audio plays on while waveforms and UI clocks stall
- Web MIDI (incl. sysex) auto-granted — the Controller never prompts
- Closing the window quits the app (single window, no hidden-but-playing state)
- Opens maximized (zoomed, not macOS fullscreen); unmaximizing restores the
  last hand-set window size. Normal bounds persist in `window-state.json`
  (gitignored); maximized sessions leave them untouched
- Dock icon is `logo.png`, set at runtime (`app.dock.setIcon`). The dock/
  menu-bar NAME can't be set at runtime on a raw Electron.app, so
  `ensure-electron.sh` patches `CFBundleName`/`CFBundleDisplayName` in the
  extracted bundle and re-signs it ad-hoc — re-applied automatically after
  any `npm install` replaces `dist/`
- No native title bar (`titleBarStyle: hidden`): the app's TopBar is the
  titlebar — drag to move, double-click to zoom (system behavior), traffic
  lights overlaid. The frontend detects the shell via user agent
  (`desktop-shell` class, `frontend/src/main.tsx`) and gates the drag-region
  CSS in `TopBar.css`; interactive TopBar elements must be `no-drag` (a
  blanket rule covers `button/a/input/select/[role=button]`)

## Why Electron (and why not "lighter" options)

- **Tauri is disqualified**: it uses WKWebView on macOS, which has **no Web
  MIDI**. The Controller (`frontend/src/midi/adapter.ts`) requires it. Do not
  "lighten" this shell to Tauri.
- Chrome `--app=` mode can't own dock identity, MIDI permission grants, or
  throttling flags, and can't show the retry page.

Stopping (#314): the shell POSTs a token-guarded shutdown hook
(`backend/serve.py`, token in `MANADJ_SHELL_TOKEN`), waits, then kills the
process tree (`taskkill /T /F` on Windows, process group on POSIX); the quit
is held until the backend is gone. The backend also exits on stdin EOF (shell
crash). Windows packaged layout: `resources\python\python.exe`, data root
`%APPDATA%\manaDJ` (`scripts/release/build_windows.py`, #317).

Distribution: ADR 0043 supersedes the old "not a distributable" stance —
packaged builds run managed mode with a bundled python/ffmpeg/frontend
(packaged-app #280).

## Troubleshooting

"Electron failed to install correctly" / "electron is not installed": the
postinstall that downloads the Electron binary was blocked (npm allow-scripts)
or silently no-opped (observed on Node 26: `install.js` cache-hits then exits
without extracting). `make app` / `make dev-app` self-heal this via
`ensure-electron.sh` (extracts from the electron cache, writes `path.txt`).
If even that fails, the manual steps are the same ones it automates:

    cd node_modules/electron && node install.js
    ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip dist/
    printf 'Electron.app/Contents/MacOS/Electron' > path.txt

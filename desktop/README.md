# manadj Desktop shell

Attach-only Electron window around a running manadj. Owns no processes or
state — `make dev` still runs the backend and Vite; this is just the window
(dock icon, no MIDI prompts, no background throttling).

## Usage

    make dev-app          # backend + frontend + shell in one command;
                          # Cmd+Q shuts everything down
    make app              # window only — attaches to http://localhost:5173
    make app PORT=5193    # attaches to a lane's Vite port
    npx electron . --url http://localhost:5193   # arbitrary URL

If nothing is running at the target, the shell shows a retry page and
auto-loads once the server comes up. `make dev-app` is orchestration in
`scripts/dev.py`, not in the shell — the shell itself stays attach-only.

Live reload: the window renders the Vite dev server, so frontend HMR and
`uvicorn --reload` work as in a browser. Changes to `main.js` itself require
relaunching the shell (rare; no electronmon dependency on purpose).

## Behavior

- `backgroundThrottling: false` — rAF/timers keep running while occluded;
  otherwise audio plays on while waveforms and UI clocks stall
- Web MIDI (incl. sysex) auto-granted — the Controller never prompts
- Closing the window quits the app (single window, no hidden-but-playing state)
- Window bounds persist in `window-state.json` (gitignored)
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

Not a distributable: no Python/ffmpeg/frontend bundling. Deliberate — see the
issue file.

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

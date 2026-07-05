# manadj Desktop shell

Attach-only Electron window around a running manadj. Owns no processes or
state — `make dev` still runs the backend and Vite; this is just the window
(dock icon, no MIDI prompts, no background throttling).

## Usage

    make app              # attaches to http://localhost:5173
    make app PORT=5193    # attaches to a lane's Vite port
    npx electron . --url http://localhost:5193   # arbitrary URL

If nothing is running at the target, the shell shows a retry page and
auto-loads once the server comes up.

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

"Electron failed to install correctly": the postinstall that downloads the
Electron binary was blocked (npm allow-scripts) or silently no-opped
(observed on Node 26: `install.js` cache-hits then exits without extracting).
Fix manually:

    npm approve-scripts electron
    cd node_modules/electron
    ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip dist/
    printf 'Electron.app/Contents/MacOS/Electron' > path.txt

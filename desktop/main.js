// manadj Desktop shell — attach-only Electron window.
//
// Attaches to an already-running manadj (`make dev`); owns no processes or
// state. See README.md and .scratch/desktop-shell/issues/01-electron-attach-shell.md.

const { app, BrowserWindow, net, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_URL = "http://localhost:5173";
const RETRY_INTERVAL_MS = 2000;
const STATE_FILE = path.join(__dirname, "window-state.json");

// --- target URL from --url / --port -----------------------------------------

function targetUrl(argv) {
  const get = (flag) => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag) return argv[i + 1];
      if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
    }
    return undefined;
  };
  const url = get("--url");
  if (url) return url;
  const port = get("--port");
  if (port) return `http://localhost:${port}`;
  return DEFAULT_URL;
}

// --- window bounds persistence -----------------------------------------------

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite)) return b;
  } catch {
    // first launch or corrupt file — fall through to defaults
  }
  return { width: 1600, height: 1000 };
}

function saveBounds(win) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(win.getNormalBounds()));
  } catch {
    // bounds persistence is best-effort
  }
}

// --- retry page (shown while the dev server is down) --------------------------

function retryPageDataUrl(target) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>manadj</title><style>
  body { background: #111; color: #ddd; font: 16px/1.5 -apple-system, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  code { color: #4fc3f7; }
  .box { text-align: center; }
</style></head><body><div class="box">
  <p>manadj is not running at <code>${target}</code></p>
  <p>start it with <code>make dev</code> — retrying every ${RETRY_INTERVAL_MS / 1000}s</p>
</div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

// --- main ---------------------------------------------------------------------

const TARGET = targetUrl(process.argv);

function probe(url) {
  return new Promise((resolve) => {
    const req = net.request(url);
    req.on("response", () => resolve(true));
    req.on("error", () => resolve(false));
    req.end();
  });
}

function attach(win) {
  win.loadURL(TARGET).catch(async () => {
    if (win.isDestroyed()) return;
    await win.loadURL(retryPageDataUrl(TARGET));
    const timer = setInterval(async () => {
      if (win.isDestroyed()) return clearInterval(timer);
      if (await probe(TARGET)) {
        clearInterval(timer);
        attach(win);
      }
    }, RETRY_INTERVAL_MS);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    ...loadBounds(),
    title: "manadj",
    webPreferences: {
      // A DJ app must never have rAF/timers throttled while occluded:
      // audio would keep playing while UI clocks and waveforms stall.
      backgroundThrottling: false,
    },
  });
  win.on("close", () => saveBounds(win));
  attach(win);
}

app.whenReady().then(() => {
  // Auto-grant Web MIDI (incl. sysex) so the Controller never prompts.
  const MIDI = new Set(["midi", "midiSysex"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(MIDI.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    MIDI.has(permission),
  );
  createWindow();
});

// Single-window app: closing the window quits, even on macOS.
// No hidden-but-playing state.
app.on("window-all-closed", () => app.quit());

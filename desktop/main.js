// manadj Desktop shell — attach-only Electron window.
//
// Attaches to an already-running manadj (`make dev`); owns no processes or
// state. See README.md and .scratch/desktop-shell/issues/01-electron-attach-shell.md.

const { app, BrowserWindow, net, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// The Vite dev target has no CSP, so Electron's renderer-console security
// warning is permanent noise — especially now that renderer console is
// forwarded to stdout. Dev-machine shell; suppress it.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const DEFAULT_URL = "http://localhost:5173";
const RETRY_INTERVAL_MS = 2000;
const STATE_FILE = path.join(__dirname, "window-state.json");

function argValue(argv, flag) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) return argv[i + 1];
    if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
  }
  return undefined;
}

function enableRemoteDebugging(argv) {
  const requested =
    process.env.MANADJ_REMOTE_DEBUG === "1" || argv.includes("--remote-debug");
  if (!requested) return;

  const port =
    process.env.MANADJ_REMOTE_DEBUG_PORT || argValue(argv, "--remote-debug-port") || "9222";
  app.commandLine.appendSwitch("remote-debugging-port", port);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  process.stdout.write(`[app] remote debugging: http://127.0.0.1:${port}/json\n`);
}

enableRemoteDebugging(process.argv);

// --- target URL from --url / --port -----------------------------------------

function targetUrl(argv) {
  const url = argValue(argv, "--url");
  if (url) return url;
  const port = argValue(argv, "--port");
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
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;
         -webkit-app-region: drag; /* no titlebar — whole retry page drags the window */ }
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
    // No native title bar: the app's TopBar is the titlebar (drag region +
    // double-click-to-zoom via CSS in frontend TopBar.css). Traffic lights
    // stay, vertically centered in the 40px bar.
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      // A DJ app must never have rAF/timers throttled while occluded:
      // audio would keep playing while UI clocks and waveforms stall.
      backgroundThrottling: false,
    },
  });
  win.on("close", () => saveBounds(win));
  forwardConsole(win.webContents);
  attach(win);
}

// Forward the renderer's console to stdout with a "[browser] " prefix.
// scripts/dev.py recognizes the prefix and relabels the line into its
// multiplexed stream; in a bare `make app` terminal it reads fine as-is.
const LEGACY_LEVELS = ["debug", "log", "warning", "error"];

function forwardConsole(webContents) {
  webContents.on("console-message", (event, legacyLevel, legacyMessage, legacyLine, legacySource) => {
    // Electron 32+ packs params on the event; older signature is positional.
    const level =
      typeof event.level === "string" ? event.level : LEGACY_LEVELS[legacyLevel] ?? "log";
    const message = String(event.message ?? legacyMessage ?? "");
    const source = event.sourceId ?? legacySource;
    const line = event.lineNumber ?? legacyLine;
    const where =
      (level === "warning" || level === "error") && source ? ` (${source}:${line})` : "";
    const tag = level === "log" || level === "info" ? "" : `${level}: `;
    for (const text of message.split("\n")) {
      process.stdout.write(`[browser] ${tag}${text}${where}\n`);
    }
  });
}

app.whenReady().then(() => {
  // Auto-grant device capabilities so nothing prompts on the dev machine:
  // Web MIDI (incl. sysex) for the Controller, media + speaker selection so
  // enumerateDevices() exposes output ids/labels and AudioContext.setSinkId
  // can target non-default devices (headphone-cue 01: the routing picker and
  // the ADR 0017 cue bridge need both), and screen-wake-lock so the display
  // never dims mid-set (screen-wake 01; denied permissions here surface as
  // NotAllowedError from navigator.wakeLock.request).
  const GRANTED = new Set(["midi", "midiSysex", "media", "speaker-selection", "screen-wake-lock"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(GRANTED.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    GRANTED.has(permission),
  );
  createWindow();
});

// Single-window app: closing the window quits, even on macOS.
// No hidden-but-playing state.
app.on("window-all-closed", () => app.quit());

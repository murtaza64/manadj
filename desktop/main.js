// manadj Desktop shell — attach-only Electron window.
//
// Attaches to an already-running manadj (`make dev`); owns no processes or
// state. See README.md and .scratch/desktop-shell/issues/01-electron-attach-shell.md.

const { app, BrowserWindow, dialog, ipcMain, net, screen, session } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { registerRecordingIpc } = require("./recording");

// The Vite dev target has no CSP, so Electron's renderer-console security
// warning is permanent noise — especially now that renderer console is
// forwarded to stdout. Dev-machine shell; suppress it.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const DEFAULT_URL = "http://localhost:5173";
const RETRY_INTERVAL_MS = 2000;
const STATE_FILE = path.join(__dirname, "window-state.json");
const APP_NAME = "manaDJ";
const DOCK_ICON = path.join(__dirname, "..", "logo.png");

// Rename what CAN be renamed at runtime (desktop-shell 06). The macOS
// dock/menu-bar NAME comes from the bundle's Info.plist, which
// ensure-electron.sh patches; setName covers the rest (e.g. notifications).
// userData defaults to appData/<name>, so pin it first — renaming must not
// silently relocate the shell's profile (localStorage, window server state).
app.setPath("userData", path.join(app.getPath("appData"), "manadj-desktop"));
app.setName(APP_NAME);

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

// --- splash page (shown until the dev server answers) -------------------------
//
// Loading screen: wordmark over a generic ring throbber. The status line
// starts as a bare "loading" and only reveals the `make dev` hint once a
// probe has actually failed (main process toggles body.down via
// executeJavaScript) — the common case is a sub-second splash.

function splashPageDataUrl(target) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>manaDJ</title><style>
  body { background: #111; color: #ddd; font: 14px/1.6 -apple-system, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;
         -webkit-app-region: drag; /* no titlebar — whole splash drags the window */ }
  .box { text-align: center; }
  .throbber { width: 28px; height: 28px; margin: 0 auto;
              border: 3px solid #333; border-top-color: #4fc3f7; border-radius: 50%;
              animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 22px; font-weight: 700; letter-spacing: 0.04em; margin: 0 0 18px;
       color: #eee; }
  .status { color: #888; min-height: 3em; margin-top: 14px; }
  .hint { display: none; }
  body.down .loading { display: none; }
  body.down .hint { display: block; }
  code { color: #4fc3f7; }
</style></head><body><div class="box">
  <h1>manaDJ</h1>
  <div class="throbber"></div>
  <div class="status">
    <p class="loading">loading…</p>
    <div class="hint">
      <p>not running at <code>${target}</code></p>
      <p>start it with <code>make dev</code> — retrying every ${RETRY_INTERVAL_MS / 1000}s</p>
    </div>
  </div>
</div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

// --- persistent renderer log (stability #188) ----------------------------------
//
// Blank-screen crashes leave no evidence when the shell runs attached (`make
// electron PORT=...`): renderer console goes only to that terminal, and a dead
// renderer takes its devtools console with it. Tee every renderer console line
// and every crash signal (render-process-gone, unresponsive, child-process-gone,
// GPU status) to an append-only file under ~/Library/Logs/manaDJ/ so the next
// occurrence is captured no matter how the shell was launched. Lines carry the
// shell pid: multiple attached shells (human app + lane apps) share the file.

const LOG_MAX_BYTES = 5 * 1024 * 1024;
let rendererLogStream = null;

function openRendererLog() {
  try {
    const dir = app.getPath("logs"); // ~/Library/Logs/manaDJ (after setName)
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "renderer.log");
    try {
      // Startup-time rotation only: keep one previous generation.
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // first launch — no file yet
    }
    rendererLogStream = fs.createWriteStream(file, { flags: "a" });
    return file;
  } catch (err) {
    process.stdout.write(`[app] renderer log unavailable: ${err.message}\n`);
    return null;
  }
}

function logRenderer(line) {
  rendererLogStream?.write(`${new Date().toISOString()} [${process.pid}] ${line}\n`);
}

// Crash signals also go to stdout — visible live in the attach terminal.
function logCrashSignal(line) {
  process.stdout.write(`[app] ${line}\n`);
  logRenderer(`[crash-signal] ${line}`);
}

function describeWebContents(wc) {
  try {
    return `wc#${wc.id} ${wc.getURL() || "(no url)"}`;
  } catch {
    return "wc#? (destroyed)";
  }
}

function instrumentCrashSignals() {
  // App-level events cover every webContents (main window, visualizer, arena)
  // without per-window wiring.
  app.on("render-process-gone", (_event, wc, details) => {
    logCrashSignal(
      `render-process-gone: reason=${details.reason} exitCode=${details.exitCode} ${describeWebContents(wc)}`,
    );
    // GPU state at the moment of death — the region-leak thread
    // (issues/stability/01) showed GPU-side exhaustion kills renderers.
    try {
      logRenderer(`[crash-signal] gpu-feature-status: ${JSON.stringify(app.getGPUFeatureStatus())}`);
    } catch {
      // best-effort
    }
  });
  app.on("child-process-gone", (_event, details) => {
    // GPU process death repaints every surface black — a classic blank screen.
    logCrashSignal(
      `child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? ""}`,
    );
  });
  // Baseline GPU state, logged once the first page finishes loading — at
  // app-ready the GPU process hasn't initialized and the status reads all
  // software. A later crash entry gets diffed against this healthy snapshot.
  let gpuBaselineLogged = false;
  app.on("web-contents-created", (_event, wc) => {
    forwardConsole(wc);
    wc.once("did-finish-load", () => {
      if (gpuBaselineLogged) return;
      gpuBaselineLogged = true;
      try {
        logRenderer(`[session] gpu-feature-status: ${JSON.stringify(app.getGPUFeatureStatus())}`);
      } catch {
        // best-effort
      }
    });
    wc.on("unresponsive", () => logCrashSignal(`unresponsive: ${describeWebContents(wc)}`));
    wc.on("responsive", () => logCrashSignal(`responsive again: ${describeWebContents(wc)}`));
    wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
      // -3 (ABORTED) is normal navigation churn; everything else is evidence.
      if (code !== -3 && isMainFrame) {
        logCrashSignal(`did-fail-load: ${code} ${desc} url=${url}`);
      }
    });
  });
}

// --- CoreAudio channel-label assertion (four-deck 33) --------------------------
//
// Known Mappings whose firmware ships all-Unknown output channel labels,
// which Chromium collapses to stereo (issue 32 / ADR 0017 amendment).
// Labels are numeric AudioChannelLabel values: 1,2,5,6 = L,R,LS,RS.
// Fire-and-forget at startup: the helper is idempotent, the written labels
// persist across replug/reboot, and a missing device/toolchain only logs.
const CHANNEL_LABEL_ASSERTS = [{ name: "DDJ-GRV6", labels: "1,2,5,6" }];

function assertChannelLabels() {
  if (process.platform !== "darwin") return;
  const helper = path.join(__dirname, "assert-channel-labels.swift");
  for (const { name, labels } of CHANNEL_LABEL_ASSERTS) {
    execFile("swift", [helper, name, labels], (err, stdout, stderr) => {
      for (const text of `${stdout}${stderr}`.trim().split("\n")) {
        if (text) process.stdout.write(`[app] ${text}\n`);
      }
      if (err) process.stdout.write(`[app] channel-label assert failed for ${name}: ${err.message}\n`);
    });
  }
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

// Splash-first attach: show the branded splash immediately (no blank
// window), then swap to the app as soon as the dev server answers. On a
// failed probe, reveal the `make dev` hint and keep retrying.
async function attach(win) {
  await win.loadURL(splashPageDataUrl(TARGET)).catch(() => {});
  const tryAttach = async () => {
    if (win.isDestroyed()) return;
    if (await probe(TARGET)) {
      win.loadURL(TARGET).catch(() => {
        // answered the probe but failed to load — treat as still down
        if (!win.isDestroyed()) attach(win);
      });
      return;
    }
    win.webContents
      .executeJavaScript("document.body.classList.add('down')")
      .catch(() => {});
    setTimeout(tryAttach, RETRY_INTERVAL_MS);
  };
  tryAttach();
}

// The visualizer child window, when open (realtime-visualization 02/03):
// the sticky/fullscreen-on-display controls target it.
let visualizerWindow = null;

// Display targeting (realtime-visualization 03): the laptop-side control
// modal lists displays and sends the visualizer fullscreen onto one (the
// HDMI projector flow — no touching the projector window itself).
function registerVisualizerIpc() {
  ipcMain.handle("visualizer:displays", () => {
    const primary = screen.getPrimaryDisplay();
    const bounds = visualizerWindow?.getBounds() ?? null;
    const currentId = bounds ? screen.getDisplayMatching(bounds).id : null;
    return screen.getAllDisplays().map((display, i) => ({
      id: display.id,
      label: display.label || `Display ${i + 1}`,
      width: display.size.width,
      height: display.size.height,
      primary: display.id === primary.id,
      current: display.id === currentId,
      fullscreen: !!visualizerWindow?.isFullScreen() && display.id === currentId,
    }));
  });
  ipcMain.handle("visualizer:fullscreen", (_event, displayId) => {
    if (!visualizerWindow) return { ok: false, reason: "visualizer window not open" };
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!display) return { ok: false, reason: "display not found" };
    const win = visualizerWindow;
    const enter = () => {
      win.setAlwaysOnTop(false); // floating windows can't enter fullscreen
      win.setBounds(display.bounds);
      win.setFullScreen(true);
    };
    if (win.isFullScreen()) {
      // macOS animates fullscreen transitions; moving displays requires
      // leaving first and re-entering once the leave settles.
      win.once("leave-full-screen", () => setTimeout(enter, 150));
      win.setFullScreen(false);
    } else {
      enter();
    }
    return { ok: true };
  });
  ipcMain.handle("visualizer:toggle-fullscreen", () => {
    if (!visualizerWindow) return { ok: false, reason: "visualizer window not open" };
    const win = visualizerWindow;
    if (win.isFullScreen()) {
      win.setFullScreen(false);
    } else {
      win.setAlwaysOnTop(false);
      win.setFullScreen(true);
    }
    return { ok: true };
  });
  ipcMain.handle("visualizer:windowed", () => {
    if (!visualizerWindow) return { ok: false, reason: "visualizer window not open" };
    visualizerWindow.setFullScreen(false);
    return { ok: true };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    ...loadBounds(),
    title: "manaDJ",
    // No native title bar: the app's TopBar is the titlebar (drag region +
    // double-click-to-zoom via CSS in frontend TopBar.css). Traffic lights
    // stay, vertically centered in the 40px bar.
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 13 },
    // Dark paint during navigation (splash → app) — never a white flash.
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // A DJ app must never have rAF/timers throttled while occluded:
      // audio would keep playing while UI clocks and waveforms stall.
      backgroundThrottling: false,
    },
  });
  // Visualizer window (realtime-visualization 01): the renderer opens it
  // via window.open('/visualizer', ...). Give it a normal native title bar
  // (its page has no TopBar drag region) and never throttle it — it renders
  // rAF visuals and may sit occluded behind the main window on one screen
  // before being dragged to the projector.
  win.webContents.setWindowOpenHandler((details) => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      title: details.frameName === "manadj-arena" ? "manaDJ arena" : "manaDJ visualizer",
      backgroundColor: "#000000",
      // An explicit webPreferences override REPLACES the opener's inherited
      // webPreferences rather than merging — so preload must be re-stated
      // here or the child window has no manadjVisualizer bridge (its ⛶ then
      // falls back to the HTML fullscreen API, which no-ops on this
      // always-on-top floating window). realtime-visualization 07.
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        backgroundThrottling: false,
      },
    },
  }));
  // Track the visualizer child window and make it sticky: floats above
  // other windows and follows across Spaces (projector second-screen use).
  win.webContents.on("did-create-window", (child, details) => {
    if (details.frameName !== "manadj-visualizer") return;
    visualizerWindow = child;
    child.setAlwaysOnTop(true, "floating");
    // NOT setVisibleOnAllWorkspaces({visibleOnFullScreen:true}): on macOS
    // it transforms the app to an accessory — the Dock icon vanished —
    // and it is incompatible with fullscreen (the broken ⛶). Sticky =
    // always-on-top only.
    // Native fullscreen needs a normal window level; restore float on exit.
    child.on("enter-full-screen", () => child.setAlwaysOnTop(false));
    child.on("leave-full-screen", () => child.setAlwaysOnTop(true, "floating"));
    child.on("closed", () => {
      if (visualizerWindow === child) visualizerWindow = null;
    });
  });
  // Open maximized (desktop-shell 06 — zoomed, not macOS fullscreen). The
  // persisted NORMAL bounds spread in above and getNormalBounds() below
  // ignores the maximized state, so unmaximizing (double-click the TopBar)
  // restores the last hand-set size across sessions.
  win.maximize();
  win.on("close", () => saveBounds(win));
  // Console forwarding is wired app-wide in instrumentCrashSignals via
  // web-contents-created (covers this window plus visualizer/arena children).
  attach(win);
}

// Forward the renderer's console to stdout with a "[browser] " prefix.
// scripts/dev.py recognizes the prefix and relabels the line into its
// multiplexed stream; in a bare `make app` terminal it reads fine as-is.
// Every line is also teed to the persistent renderer log (stability #188).
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
      logRenderer(`[browser] ${tag}${text}${where}`);
    }
  });
}

const rendererLogFile = openRendererLog();
logRenderer(
  `[session] shell start pid=${process.pid} target=${TARGET} ` +
    `electron=${process.versions.electron} chrome=${process.versions.chrome}`,
);
if (rendererLogFile) process.stdout.write(`[app] renderer log: ${rendererLogFile}\n`);
instrumentCrashSignals();

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
  // Dock icon is runtime-settable even on a raw Electron.app (unlike the
  // name). Best-effort: a missing logo must never block the shell.
  try {
    app.dock?.setIcon(DOCK_ICON);
  } catch {
    // logo.png missing/unreadable — keep the default icon
  }
  assertChannelLabels();
  const disposeRecordingIpc = registerRecordingIpc({ app, dialog, ipcMain });
  app.once("before-quit", disposeRecordingIpc);
  registerVisualizerIpc();
  createWindow();
});

// Single-window app: closing the window quits, even on macOS.
// No hidden-but-playing state.
app.on("window-all-closed", () => app.quit());

// A clean-quit marker distinguishes "user closed the app" from "the log just
// stops" (main-process death) when reading the file after an incident.
app.on("quit", (_event, exitCode) => {
  logRenderer(`[session] shell quit exitCode=${exitCode}`);
  rendererLogStream?.end();
});

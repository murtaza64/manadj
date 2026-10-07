// Managed backend for the packaged app (packaged-app #279, ADR 0043).
//
// In the packaged app, Electron owns the backend: pick a free port, spawn
// uvicorn from a bundled (or configured) python, wait for health, and stop
// it on quit. Dev stays attach-only (main.js); this module is inert there.
//
// Resolution contract (shared with #277 data-root work and #280 bundling):
//   MANADJ_DATA_DIR     data root, exported to the backend; packaged default
//                       ~/Library/Application Support/manaDJ
//   MANADJ_PYTHON       python executable; packaged default
//                       <resources>/python/bin/python3
//   MANADJ_BACKEND_ROOT repo-shaped tree (backend/, alembic/, alembic.ini,
//                       frontend/dist); packaged default <resources>/backend
//   MANADJ_FFMPEG_DIR   dir holding ffmpeg/ffprobe, prepended to the
//                       backend's PATH; packaged default <resources>/ffmpeg
//                       (only when it exists)
//   MANADJ_PACKAGED=1   set for packaged builds (backend/data_root.py, #277)

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const RECENT_LINES_MAX = 120;
const STOP_KILL_AFTER_MS = 5000;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Resolve where the managed backend lives and runs.
 *
 * @param {{ isPackaged: boolean, resourcesPath: string, appDataPath: string,
 *           repoRoot: string }} ctx
 */
function resolveBackendConfig({ isPackaged, resourcesPath, appDataPath, repoRoot }) {
  const backendRoot =
    process.env.MANADJ_BACKEND_ROOT ||
    (isPackaged ? path.join(resourcesPath, "backend") : repoRoot);
  const python =
    process.env.MANADJ_PYTHON ||
    (isPackaged
      ? path.join(resourcesPath, "python", "bin", "python3")
      : path.join(repoRoot, ".venv", "bin", "python3"));
  // Packaged: all state in the per-user data root. Unpackaged --managed:
  // leave MANADJ_DATA_DIR alone (unset means the backend uses its repo
  // defaults — the dev contract).
  const dataRoot =
    process.env.MANADJ_DATA_DIR ||
    (isPackaged ? path.join(appDataPath, "manaDJ") : null);
  const bundledFfmpeg = path.join(resourcesPath, "ffmpeg");
  const ffmpegDir =
    process.env.MANADJ_FFMPEG_DIR ||
    (isPackaged && fs.existsSync(bundledFfmpeg) ? bundledFfmpeg : null);
  return { backendRoot, python, dataRoot, ffmpegDir, packaged: isPackaged };
}

/**
 * Spawn uvicorn on a free localhost port. Returns a handle immediately;
 * health waiting is the caller's loop (it owns the window/splash).
 *
 * @param {ReturnType<typeof resolveBackendConfig>} cfg
 * @param {{ logFile: string, onLine?: (line: string) => void,
 *           onExit?: (code: number | null, signal: string | null) => void }} hooks
 */
async function startBackend(cfg, { logFile, onLine, onExit }) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;

  const env = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (cfg.dataRoot) {
    fs.mkdirSync(cfg.dataRoot, { recursive: true });
    env.MANADJ_DATA_DIR = cfg.dataRoot;
  }
  // backend/data_root.py (#277): packaged posture (data root, Export off
  // by default, dev surfaces hidden) keys off MANADJ_PACKAGED.
  if (cfg.packaged) env.MANADJ_PACKAGED = "1";
  if (cfg.ffmpegDir) env.PATH = cfg.ffmpegDir + path.delimiter + (env.PATH || "");

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  logStream.write(
    `\n${new Date().toISOString()} [shell] spawning backend: ${cfg.python} -m uvicorn ` +
      `backend.main:app on ${url} (cwd ${cfg.backendRoot}` +
      `${cfg.dataRoot ? `, data root ${cfg.dataRoot}` : ""})\n`,
  );

  const child = spawn(
    cfg.python,
    ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: cfg.backendRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );

  const handle = {
    child,
    port,
    url,
    logFile,
    recentLines: [],
    exited: false,
    exitCode: null,
    spawnError: null,
  };

  const takeLine = (line) => {
    if (!line) return;
    handle.recentLines.push(line);
    if (handle.recentLines.length > RECENT_LINES_MAX) handle.recentLines.shift();
    logStream.write(`${new Date().toISOString()} ${line}\n`);
    onLine?.(line);
  };
  const wireStream = (stream) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) takeLine(line.trimEnd());
    });
    stream.on("end", () => takeLine(buf.trimEnd()));
  };
  wireStream(child.stdout);
  wireStream(child.stderr);

  child.on("error", (err) => {
    // e.g. the configured python doesn't exist — no "exit" will follow.
    handle.spawnError = err;
    handle.exited = true;
    takeLine(`[shell] failed to spawn backend: ${err.message}`);
    logStream.end();
    onExit?.(null, null);
  });
  child.on("exit", (code, signal) => {
    handle.exited = true;
    handle.exitCode = code;
    takeLine(`[shell] backend exited code=${code} signal=${signal ?? ""}`);
    logStream.end();
    onExit?.(code, signal);
  });

  return handle;
}

/** SIGTERM (uvicorn shuts down cleanly), SIGKILL if it lingers. */
function stopBackend(handle) {
  if (!handle || handle.exited) return;
  handle.child.kill("SIGTERM");
  const hardKill = setTimeout(() => {
    if (!handle.exited) handle.child.kill("SIGKILL");
  }, STOP_KILL_AFTER_MS);
  hardKill.unref?.();
}

module.exports = { resolveBackendConfig, startBackend, stopBackend, freePort };

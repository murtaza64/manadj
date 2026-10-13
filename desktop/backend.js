// Managed backend for the packaged app (packaged-app #279, ADR 0043;
// Windows supervision #314).
//
// In the packaged app, Electron owns the backend: pick a free port, spawn
// `python -m backend.serve` from a bundled (or configured) python, wait for
// health, and stop it on quit. Dev stays attach-only (main.js); this module
// is inert there.
//
// Resolution contract (shared with #277 data-root work, #280/#317 bundling):
//   MANADJ_DATA_DIR     data root, exported to the backend; packaged default
//                       <appData>/manaDJ (macOS ~/Library/Application
//                       Support/manaDJ, Windows %APPDATA%\manaDJ)
//   MANADJ_PYTHON       python executable; packaged default
//                       <resources>/python/bin/python3 (Windows:
//                       <resources>\python\python.exe)
//   MANADJ_BACKEND_ROOT repo-shaped tree (backend/, alembic/, alembic.ini,
//                       frontend/dist); packaged default <resources>/backend
//   MANADJ_FFMPEG_DIR   dir holding ffmpeg/ffprobe, prepended to the
//                       backend's PATH; packaged default <resources>/ffmpeg
//                       (only when it exists)
//   MANADJ_SLSKD_BIN    bundled slskd (#291), exported when
//                       <resources>/slskd/slskd[.exe] exists
//   MANADJ_PACKAGED=1   set for packaged builds (backend/data_root.py, #277)
//
// Stopping (#314): POSIX signals shut uvicorn down cleanly, but on Windows
// child.kill() is TerminateProcess — no lifespan shutdown, no worker stop.
// So every platform stops the same way: POST the token-guarded shutdown
// hook (backend/serve.py), wait, then kill the whole process tree (the
// backend spawns ffmpeg/demucs children) if it is still alive. A stdin
// lifeline covers the shell dying without a clean quit: the backend exits
// when its stdin hits EOF.

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const RECENT_LINES_MAX = 120;
const GRACEFUL_STOP_MS = 8000;
const KILL_WAIT_MS = 3000;
const SHUTDOWN_PATH = "/api/_shell/shutdown";

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
 *           repoRoot: string, platform?: string, env?: object,
 *           exists?: (p: string) => boolean }} ctx
 */
function resolveBackendConfig({
  isPackaged,
  resourcesPath,
  appDataPath,
  repoRoot,
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const backendRoot =
    env.MANADJ_BACKEND_ROOT || (isPackaged ? p.join(resourcesPath, "backend") : repoRoot);
  const python =
    env.MANADJ_PYTHON ||
    (isPackaged
      ? pythonInFor(p, p.join(resourcesPath, "python"), platform, false)
      : pythonInFor(p, p.join(repoRoot, ".venv"), platform, true));
  // Packaged: all state in the per-user data root. Unpackaged --managed:
  // leave MANADJ_DATA_DIR alone (unset means the backend uses its repo
  // defaults — the dev contract).
  const dataRoot = env.MANADJ_DATA_DIR || (isPackaged ? p.join(appDataPath, "manaDJ") : null);
  const bundledFfmpeg = p.join(resourcesPath, "ffmpeg");
  const ffmpegDir =
    env.MANADJ_FFMPEG_DIR || (isPackaged && exists(bundledFfmpeg) ? bundledFfmpeg : null);
  const bundledSlskd = p.join(resourcesPath, "slskd", platform === "win32" ? "slskd.exe" : "slskd");
  const slskdBin = env.MANADJ_SLSKD_BIN || (isPackaged && exists(bundledSlskd) ? bundledSlskd : null);
  return { backendRoot, python, dataRoot, ffmpegDir, slskdBin, packaged: isPackaged, platform };
}

function pythonInFor(p, dir, platform, venv) {
  if (platform === "win32") {
    return venv ? p.join(dir, "Scripts", "python.exe") : p.join(dir, "python.exe");
  }
  return p.join(dir, "bin", "python3");
}

/** Environment for the backend process. */
function backendEnv(cfg, { token, baseEnv = process.env }) {
  const env = { ...baseEnv, PYTHONUNBUFFERED: "1", PYTHONUTF8: "1", MANADJ_SHELL_TOKEN: token };
  // backend/serve.py exits when the shell's end of stdin closes.
  env.MANADJ_SHELL_LIFELINE = "1";
  if (cfg.dataRoot) env.MANADJ_DATA_DIR = cfg.dataRoot;
  // Packaged: bytecode goes to the data root, never into the signed bundle
  // (writing __pycache__ there breaks the code seal and fails on read-only
  // installs).
  if (cfg.packaged && cfg.dataRoot) {
    const sep = cfg.platform === "win32" ? "\\" : "/";
    env.PYTHONPYCACHEPREFIX = cfg.dataRoot + sep + "pycache";
  }
  // backend/data_root.py (#277): packaged posture (data root, Export off
  // by default, dev surfaces hidden) keys off MANADJ_PACKAGED.
  if (cfg.packaged) env.MANADJ_PACKAGED = "1";
  if (cfg.slskdBin) env.MANADJ_SLSKD_BIN = cfg.slskdBin;
  if (cfg.ffmpegDir) {
    // Windows env keys are case-insensitive but node preserves the
    // original spelling ("Path"); prepend to whichever key exists.
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "PATH";
    const delim = cfg.platform === "win32" ? ";" : ":";
    env[key] = cfg.ffmpegDir + delim + (env[key] || "");
  }
  return env;
}

/**
 * Spawn the backend on a free localhost port. Returns a handle immediately;
 * health waiting is the caller's loop (it owns the window/splash).
 *
 * @param {ReturnType<typeof resolveBackendConfig>} cfg
 * @param {{ logFile: string, onLine?: (line: string) => void,
 *           onExit?: (code: number | null, signal: string | null) => void }} hooks
 */
async function startBackend(cfg, { logFile, onLine, onExit }) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(24).toString("hex");

  if (cfg.dataRoot) fs.mkdirSync(cfg.dataRoot, { recursive: true });
  const env = backendEnv(cfg, { token });

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  logStream.write(
    `\n${new Date().toISOString()} [shell] spawning backend: ${cfg.python} -m backend.serve ` +
      `on ${url} (cwd ${cfg.backendRoot}` +
      `${cfg.dataRoot ? `, data root ${cfg.dataRoot}` : ""})\n`,
  );

  const child = spawn(
    cfg.python,
    ["-m", "backend.serve", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: cfg.backendRoot,
      env,
      // stdin = lifeline pipe (never written; EOF when the shell dies)
      stdio: ["pipe", "pipe", "pipe"],
      // POSIX: own process group, so the tree kill reaches ffmpeg/demucs.
      detached: cfg.platform !== "win32",
      windowsHide: true,
    },
  );

  const handle = {
    child,
    port,
    url,
    token,
    logFile,
    platform: cfg.platform,
    recentLines: [],
    exited: false,
    exitCode: null,
    spawnError: null,
    exitPromise: null,
  };
  let resolveExit;
  handle.exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

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
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) takeLine(line.trimEnd());
    });
    stream.on("end", () => takeLine(buf.trimEnd()));
  };
  wireStream(child.stdout);
  wireStream(child.stderr);
  child.stdin.on("error", () => {}); // EPIPE once the backend is gone

  child.on("error", (err) => {
    // e.g. the configured python doesn't exist — no "exit" will follow.
    handle.spawnError = err;
    handle.exited = true;
    takeLine(`[shell] failed to spawn backend: ${err.message}`);
    logStream.end();
    resolveExit();
    onExit?.(null, null);
  });
  child.on("exit", (code, signal) => {
    handle.exited = true;
    handle.exitCode = code;
    takeLine(`[shell] backend exited code=${code} signal=${signal ?? ""}`);
    logStream.end();
    resolveExit();
    onExit?.(code, signal);
  });

  return handle;
}

function requestShutdown(handle) {
  return new Promise((resolve) => {
    const req = http.request(
      `${handle.url}${SHUTDOWN_PATH}`,
      { method: "POST", headers: { "X-Manadj-Shell-Token": handle.token }, timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 202);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Kill the backend and everything it spawned. */
function killTree(handle, { platform = handle.platform, run = spawnSync, kill = process.kill } = {}) {
  const pid = handle.child.pid;
  if (!pid) return;
  if (platform === "win32") {
    run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    kill(-pid, "SIGKILL"); // process group (spawned detached)
  } catch {
    try {
      kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function waitExit(handle, ms) {
  return Promise.race([
    handle.exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), ms).unref?.()),
  ]);
}

/**
 * Stop the backend: graceful shutdown hook, then a process-tree kill if it
 * is still alive after GRACEFUL_STOP_MS. Resolves once it has exited (or
 * the kill has been issued and waited on).
 */
async function stopBackend(handle) {
  if (!handle || handle.exited) return;
  const asked = await requestShutdown(handle);
  if (!asked && handle.platform !== "win32") {
    // Hook unreachable (backend still starting?) — POSIX can still ask nicely.
    try {
      process.kill(-handle.child.pid, "SIGTERM");
    } catch {
      handle.child.kill("SIGTERM");
    }
  }
  if (await waitExit(handle, GRACEFUL_STOP_MS)) return;
  killTree(handle);
  await waitExit(handle, KILL_WAIT_MS);
}

module.exports = {
  resolveBackendConfig,
  backendEnv,
  startBackend,
  stopBackend,
  killTree,
  freePort,
};

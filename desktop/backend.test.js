// node --test desktop/backend.test.js
const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveBackendConfig, backendEnv, killTree } = require("./backend");

const all = () => true;
const none = () => false;

test("macOS packaged layout", () => {
  const cfg = resolveBackendConfig({
    isPackaged: true,
    resourcesPath: "/A/manaDJ.app/Contents/Resources",
    appDataPath: "/Users/u/Library/Application Support",
    repoRoot: "/repo",
    platform: "darwin",
    env: {},
    exists: all,
  });
  assert.equal(cfg.python, "/A/manaDJ.app/Contents/Resources/python/bin/python3");
  assert.equal(cfg.backendRoot, "/A/manaDJ.app/Contents/Resources/backend");
  assert.equal(cfg.dataRoot, "/Users/u/Library/Application Support/manaDJ");
  assert.equal(cfg.ffmpegDir, "/A/manaDJ.app/Contents/Resources/ffmpeg");
  assert.equal(cfg.slskdBin, "/A/manaDJ.app/Contents/Resources/slskd/slskd");
});

test("Windows packaged layout", () => {
  const cfg = resolveBackendConfig({
    isPackaged: true,
    resourcesPath: "C:\\Users\\u\\AppData\\Local\\Programs\\manaDJ\\resources",
    appDataPath: "C:\\Users\\u\\AppData\\Roaming",
    repoRoot: "C:\\repo",
    platform: "win32",
    env: {},
    exists: all,
  });
  assert.equal(cfg.python, "C:\\Users\\u\\AppData\\Local\\Programs\\manaDJ\\resources\\python\\python.exe");
  assert.equal(cfg.dataRoot, "C:\\Users\\u\\AppData\\Roaming\\manaDJ");
  assert.equal(cfg.slskdBin, "C:\\Users\\u\\AppData\\Local\\Programs\\manaDJ\\resources\\slskd\\slskd.exe");
});

test("Windows dev --managed uses the venv Scripts python and no data root", () => {
  const cfg = resolveBackendConfig({
    isPackaged: false,
    resourcesPath: "C:\\electron\\resources",
    appDataPath: "C:\\Users\\u\\AppData\\Roaming",
    repoRoot: "C:\\repo",
    platform: "win32",
    env: {},
    exists: none,
  });
  assert.equal(cfg.python, "C:\\repo\\.venv\\Scripts\\python.exe");
  assert.equal(cfg.dataRoot, null);
  assert.equal(cfg.ffmpegDir, null);
  assert.equal(cfg.slskdBin, null);
});

test("missing bundled ffmpeg/slskd are not exported", () => {
  const cfg = resolveBackendConfig({
    isPackaged: true, resourcesPath: "/R", appDataPath: "/D", repoRoot: "/repo",
    platform: "darwin", env: {}, exists: none,
  });
  assert.equal(cfg.ffmpegDir, null);
  assert.equal(cfg.slskdBin, null);
  assert.equal(backendEnv(cfg, { token: "t", baseEnv: {} }).MANADJ_SLSKD_BIN, undefined);
});

test("env overrides win", () => {
  const cfg = resolveBackendConfig({
    isPackaged: true, resourcesPath: "/R", appDataPath: "/D", repoRoot: "/repo", platform: "darwin",
    env: { MANADJ_PYTHON: "/py", MANADJ_DATA_DIR: "/data", MANADJ_SLSKD_BIN: "/s" },
    exists: none,
  });
  assert.equal(cfg.python, "/py");
  assert.equal(cfg.dataRoot, "/data");
  assert.equal(cfg.slskdBin, "/s");
});

test("backend env: token, lifeline, packaged, ffmpeg on Windows Path key", () => {
  const cfg = {
    dataRoot: "C:\\data", packaged: true, ffmpegDir: "C:\\R\\ffmpeg", slskdBin: null, platform: "win32",
  };
  const env = backendEnv(cfg, { token: "tok", baseEnv: { Path: "C:\\Windows" } });
  assert.equal(env.MANADJ_SHELL_TOKEN, "tok");
  assert.equal(env.MANADJ_SHELL_LIFELINE, "1");
  assert.equal(env.MANADJ_PACKAGED, "1");
  assert.equal(env.MANADJ_DATA_DIR, "C:\\data");
  assert.equal(env.PYTHONPYCACHEPREFIX, "C:\\data\\pycache");
  assert.equal(env.Path, "C:\\R\\ffmpeg;C:\\Windows");
  assert.equal(env.PATH, undefined);
});

test("killTree: taskkill /T /F on Windows, process group on POSIX", () => {
  const calls = [];
  killTree({ child: { pid: 42 } }, { platform: "win32", run: (...a) => calls.push(a) });
  assert.deepEqual(calls[0].slice(0, 2), ["taskkill", ["/PID", "42", "/T", "/F"]]);

  const kills = [];
  killTree({ child: { pid: 42 } }, { platform: "darwin", kill: (pid, sig) => kills.push([pid, sig]) });
  assert.deepEqual(kills, [[-42, "SIGKILL"]]);
});

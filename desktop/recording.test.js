const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ensureRecordingExtension,
  ffmpegRecordingArgs,
  loadLastSaveDirectory,
  registerRecordingIpc,
  safeSuggestedName,
  saveLastSaveDirectory,
} = require("./recording");

test("normalizes recording filenames", () => {
  assert.equal(ensureRecordingExtension("mix", "wav"), "mix.wav");
  assert.equal(ensureRecordingExtension("mix.MP3", "mp3"), "mix.MP3");
  assert.equal(safeSuggestedName("2026/07/16: set", "mp3"), "2026-07-16- set.mp3");
});

test("builds float WAV and 320 kbps MP3 ffmpeg commands", () => {
  const base = { rawPath: "/tmp/in.raw", sampleRate: 48000, channels: 2 };
  const wav = ffmpegRecordingArgs({ ...base, outputPath: "/tmp/out.wav", format: "wav" });
  assert.deepEqual(wav.slice(0, 12), [
    "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "/tmp/in.raw", "-vn",
  ]);
  assert.ok(wav.includes("pcm_f32le"));
  const mp3 = ffmpegRecordingArgs({ ...base, outputPath: "/tmp/out.mp3", format: "mp3" });
  assert.ok(mp3.includes("libmp3lame"));
  assert.ok(mp3.includes("320k"));
});

test("persists the last successful save directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "manadj-recording-test-"));
  const statePath = path.join(directory, "state", "recording.json");
  try {
    assert.equal(loadLastSaveDirectory(statePath), null);
    saveLastSaveDirectory(statePath, "/Users/test/Mixes");
    assert.equal(loadLastSaveDirectory(statePath), "/Users/test/Mixes");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("allows only one save dialog per stopped recording", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "manadj-recording-ipc-test-"));
  const handlers = new Map();
  const listeners = new Map();
  let resolveDialog;
  const dialogResult = new Promise((resolve) => {
    resolveDialog = resolve;
  });
  const dispose = registerRecordingIpc({
    app: {
      getPath(name) {
        return name === "userData" ? path.join(directory, "user") : directory;
      },
    },
    dialog: { showSaveDialog: () => dialogResult },
    ipcMain: {
      handle: (name, handler) => handlers.set(name, handler),
      on: (name, listener) => listeners.set(name, listener),
    },
  });
  try {
    const { id } = await handlers.get("recording:start")(null, { sampleRate: 48000, channels: 2 });
    listeners.get("recording:chunk")(null, { id, buffer: new Float32Array([0, 0]).buffer });
    await handlers.get("recording:stop")(null, id);
    const first = handlers.get("recording:save")(null, {
      id,
      format: "wav",
      suggestedName: "test",
    });
    await assert.rejects(
      handlers.get("recording:save")(null, { id, format: "wav", suggestedName: "test" }),
      /not ready to save/,
    );
    resolveDialog({ canceled: true });
    assert.deepEqual(await first, { canceled: true });
  } finally {
    dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

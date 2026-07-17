const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  ensureRecordingExtension,
  ffmpegRecordingArgs,
  loadLastSaveDirectory,
  RECORDING_PEAK_CEILING,
  registerRecordingIpc,
  runFfmpeg,
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

test("production preload delivers PCM ArrayBuffers to Electron main", () => {
  const electron = require("electron");
  const output = execFileSync(electron, [path.join(__dirname, "recording-ipc-smoke.js")], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.match(output, /recording IPC bytes=16/);
});

test("ffmpeg preserves recording duration in WAV and MP3 outputs", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "manadj-recording-codec-test-"));
  const rawPath = path.join(directory, "one-second.f32le");
  const sampleRate = 48000;
  const samples = Buffer.alloc(sampleRate * 2 * 4);
  for (let frame = 0; frame < sampleRate; frame++) {
    const sample = 1.25 * Math.sin((2 * Math.PI * 1000 * frame) / sampleRate);
    samples.writeFloatLE(sample, frame * 8);
    samples.writeFloatLE(sample, frame * 8 + 4);
  }
  fs.writeFileSync(rawPath, samples);
  try {
    for (const format of ["wav", "mp3"]) {
      const outputPath = path.join(directory, `out.${format}`);
      await runFfmpeg(
        ffmpegRecordingArgs({ rawPath, outputPath, sampleRate, channels: 2, format }),
      );
      const duration = Number(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", outputPath],
          { encoding: "utf8" },
        ).trim(),
      );
      assert.ok(Math.abs(duration - 1) < 0.05, `${format} duration was ${duration}`);
      const decoded = execFileSync(
        "ffmpeg",
        ["-v", "error", "-i", outputPath, "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
        { maxBuffer: 2_000_000 },
      );
      let peak = 0;
      for (let offset = 0; offset < decoded.length; offset += 4) {
        peak = Math.max(peak, Math.abs(decoded.readFloatLE(offset)));
      }
      assert.ok(peak <= 1, `${format} decoded peak was ${peak}`);
      assert.ok(peak >= RECORDING_PEAK_CEILING * 0.8, `${format} peak was unexpectedly low: ${peak}`);
    }

    const quietRaw = path.join(directory, "quiet.f32le");
    const quietSamples = Buffer.alloc(sampleRate * 2 * 4);
    for (let frame = 0; frame < sampleRate; frame++) {
      const sample = 0.25 * Math.sin((2 * Math.PI * 1000 * frame) / sampleRate);
      quietSamples.writeFloatLE(sample, frame * 8);
      quietSamples.writeFloatLE(sample, frame * 8 + 4);
    }
    fs.writeFileSync(quietRaw, quietSamples);
    const quietWav = path.join(directory, "quiet.wav");
    await runFfmpeg(
      ffmpegRecordingArgs({
        rawPath: quietRaw,
        outputPath: quietWav,
        sampleRate,
        channels: 2,
        format: "wav",
      }),
    );
    const quietDecoded = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", quietWav, "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
      { maxBuffer: 2_000_000 },
    );
    let quietPeak = 0;
    for (let offset = 0; offset < quietDecoded.length; offset += 4) {
      quietPeak = Math.max(quietPeak, Math.abs(quietDecoded.readFloatLE(offset)));
    }
    assert.ok(Math.abs(quietPeak - 0.25) < 0.001, `below-ceiling peak changed to ${quietPeak}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

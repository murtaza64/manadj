const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const sessions = new Map();
// MP3 encoding can add ~1.5 dB of intersample/codec overshoot. A -2 dBFS
// sample ceiling kept the analyzed +2.4 dBTP repro below 0 dBTP after encode.
const RECORDING_PEAK_CEILING = 0.794328;

function recordingExtension(format) {
  return format === "mp3" ? ".mp3" : ".wav";
}

function ensureRecordingExtension(filePath, format) {
  const extension = recordingExtension(format);
  return filePath.toLowerCase().endsWith(extension) ? filePath : `${filePath}${extension}`;
}

function safeSuggestedName(name, format) {
  const cleaned = String(name || "manaDJ recording")
    .replace(/[/:\\]/g, "-")
    .trim() || "manaDJ recording";
  return ensureRecordingExtension(cleaned, format);
}

function loadLastSaveDirectory(statePath) {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return typeof value.lastSaveDirectory === "string" && value.lastSaveDirectory
      ? value.lastSaveDirectory
      : null;
  } catch {
    return null;
  }
}

function saveLastSaveDirectory(statePath, directory) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ lastSaveDirectory: directory }));
}

function ffmpegRecordingArgs({ rawPath, outputPath, sampleRate, channels, format }) {
  const codec =
    format === "mp3"
      ? ["-c:a", "libmp3lame", "-b:a", "320k"]
      : ["-c:a", "pcm_f32le"];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "f32le",
    "-ar",
    String(sampleRate),
    "-ac",
    String(channels),
    "-i",
    rawPath,
    "-vn",
    "-af",
    `alimiter=limit=${RECORDING_PEAK_CEILING}:attack=5:release=50:level=disabled`,
    ...codec,
    "-y",
    outputPath,
  ];
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_000) stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with status ${code}`));
    });
  });
}

function closeSessionStream(session) {
  if (session.status !== "recording") return Promise.resolve();
  if (session.streamError) return Promise.reject(session.streamError);
  session.status = "stopping";
  return new Promise((resolve, reject) => {
    session.stream.once("error", reject);
    session.stream.end(() => {
      session.status = "stopped";
      resolve();
    });
  });
}

function discardSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.status === "recording") session.stream.destroy();
  fs.rmSync(session.rawPath, { force: true });
}

function registerRecordingIpc({ app, dialog, ipcMain }) {
  const statePath = path.join(app.getPath("userData"), "recording-state.json");
  let lastSaveDirectory = loadLastSaveDirectory(statePath);
  ipcMain.handle("recording:start", (_event, meta) => {
    const sampleRate = Number(meta?.sampleRate);
    const channels = Number(meta?.channels);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channels !== 2) {
      throw new TypeError("invalid recorder audio format");
    }
    const id = randomUUID();
    const rawPath = path.join(os.tmpdir(), `manadj-recording-${id}.f32le`);
    const session = {
      rawPath,
      sampleRate,
      channels,
      status: "recording",
      stream: fs.createWriteStream(rawPath),
      streamError: null,
    };
    // A write error (most notably disk full) can happen long before Stop.
    // Keep it attached for the session lifetime so Electron never crashes
    // on an unhandled stream error; Stop surfaces it through the recorder UI.
    session.stream.on("error", (error) => {
      session.streamError = error;
    });
    sessions.set(id, session);
    return { id };
  });

  ipcMain.on("recording:chunk", (_event, payload) => {
    const session = sessions.get(payload?.id);
    if (!session || session.status !== "recording" || session.streamError) return;
    const data = payload.buffer;
    if (data instanceof ArrayBuffer) session.stream.write(Buffer.from(data));
    else if (ArrayBuffer.isView(data)) {
      session.stream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  });

  ipcMain.handle("recording:stop", async (_event, id) => {
    const session = sessions.get(id);
    if (!session) throw new Error("recording session not found");
    await closeSessionStream(session);
    const bytes = fs.statSync(session.rawPath).size;
    return {
      bytes,
      durationSeconds: bytes / (session.sampleRate * session.channels * 4),
    };
  });

  ipcMain.handle("recording:save", async (_event, request) => {
    const session = sessions.get(request?.id);
    if (!session || session.status !== "stopped") {
      throw new Error("recording is not ready to save");
    }
    session.status = "saving";
    const format = request.format === "mp3" ? "mp3" : "wav";
    const extension = recordingExtension(format).slice(1);
    let outputPath = null;
    try {
      const result = await dialog.showSaveDialog({
        title: "Save master recording",
        defaultPath: path.join(
          lastSaveDirectory ?? app.getPath("music"),
          safeSuggestedName(request.suggestedName, format),
        ),
        filters: [
          {
            name: format === "mp3" ? "MP3 audio (320 kbps)" : "Float WAV audio",
            extensions: [extension],
          },
        ],
      });
      if (result.canceled || !result.filePath) {
        discardSession(request.id);
        return { canceled: true };
      }
      outputPath = ensureRecordingExtension(result.filePath, format);
      await runFfmpeg(
        ffmpegRecordingArgs({
          rawPath: session.rawPath,
          outputPath,
          sampleRate: session.sampleRate,
          channels: session.channels,
          format,
        }),
      );
      discardSession(request.id);
      lastSaveDirectory = path.dirname(outputPath);
      saveLastSaveDirectory(statePath, lastSaveDirectory);
      return { canceled: false, path: outputPath };
    } catch (error) {
      if (outputPath) fs.rmSync(outputPath, { force: true });
      session.status = "stopped";
      throw error;
    }
  });

  ipcMain.handle("recording:discard", (_event, id) => discardSession(id));

  return () => {
    for (const id of sessions.keys()) discardSession(id);
  };
}

module.exports = {
  ensureRecordingExtension,
  ffmpegRecordingArgs,
  loadLastSaveDirectory,
  RECORDING_PEAK_CEILING,
  registerRecordingIpc,
  runFfmpeg,
  safeSuggestedName,
  saveLastSaveDirectory,
};

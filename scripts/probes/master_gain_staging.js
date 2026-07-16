#!/usr/bin/env node
/*
 * Repeatable Master gain-stage harness (master-headroom 01).
 *
 * Runs the production channel EQ/filter and DynamicsCompressor settings in
 * Electron's real OfflineAudioContext, then measures decoded input,
 * post-EQ/filter channel, summed pre-Master, post-Master, and
 * post-compressor stages. The correlated/typical/trim/EQ/filter/crossfader
 * scenarios cover the ticket's deterministic digital half. One rendered
 * post-compressor signal is also passed through the production ffmpeg export
 * ceiling and decoded again.
 *
 *   cd desktop
 *   npx electron ../scripts/probes/master_gain_staging.js [--json] \
 *     [--track /path/to/track-a] [--track /path/to/track-b]
 *
 * Physical CoreAudio/device/DAC measurements are deliberately separate:
 * use coreaudio_output_probe.swift, then the hardware Walkthrough with a
 * loopback interface. This harness never emits sound.
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ffmpegRecordingArgs,
  runFfmpeg,
} = require("../../desktop/recording");

const JSON_OUTPUT = process.argv.includes("--json");
const TRACK_PATHS = process.argv.flatMap((arg, index, args) =>
  arg === "--track" && args[index + 1] ? [path.resolve(args[index + 1])] : []
);
const SAMPLE_RATE = 48_000;
const RAW_PATH = path.join(os.tmpdir(), `manadj-master-harness-${process.pid}.f32le`);

const HTML = String.raw`<!doctype html><script>
const { ipcRenderer } = require("electron");
const fs = require("node:fs");

const SAMPLE_RATE = ${SAMPLE_RATE};
const DURATION_SECONDS = 2;
const LEAD_SECONDS = 0.25;
const FRAMES = SAMPLE_RATE * DURATION_SECONDS;
const BUTTERWORTH_Q_DB = -3.0103;

function dbToGain(db) { return 10 ** (db / 20); }
function db(value) { return value > 0 ? 20 * Math.log10(value) : -Infinity; }

function signalData(kind, frequency = 997, provided = null) {
  if (provided) return provided;
  const data = new Float32Array(FRAMES);
  for (let frame = Math.floor(LEAD_SECONDS * SAMPLE_RATE); frame < FRAMES; frame++) {
    const t = (frame - LEAD_SECONDS * SAMPLE_RATE) / SAMPLE_RATE;
    if (kind === "full") {
      data[frame] = Math.sin(2 * Math.PI * frequency * t);
    } else {
      // Dense, deterministic "typical mastered" waveform, normalized to
      // 0.98 sample peak. Different phase variants decorrelate two tracks.
      const phase = kind === "typical-b" ? 1.137 : 0;
      data[frame] =
        0.68 * Math.sin(2 * Math.PI * 997 * t + phase) +
        0.2 * Math.sin(2 * Math.PI * 1997 * t + phase * 0.7) +
        0.1 * Math.sin(2 * Math.PI * 499 * t + phase * 1.3);
    }
  }
  if (kind !== "full") {
    let peak = 0;
    for (const sample of data) peak = Math.max(peak, Math.abs(sample));
    const scale = 0.98 / peak;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
  return data;
}

function makeFilter(ctx, type, frequency) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = BUTTERWORTH_Q_DB;
  return node;
}

function chain(nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

function channelStrip(ctx, source, config) {
  const trim = ctx.createGain();
  trim.gain.value = dbToGain(config.trimDb ?? 0);
  source.connect(trim);
  const sum = ctx.createGain();
  const bands = [
    [makeFilter(ctx, "lowpass", 250), makeFilter(ctx, "lowpass", 250)],
    [
      makeFilter(ctx, "highpass", 250),
      makeFilter(ctx, "highpass", 250),
      makeFilter(ctx, "lowpass", 2500),
      makeFilter(ctx, "lowpass", 2500),
    ],
    [makeFilter(ctx, "highpass", 2500), makeFilter(ctx, "highpass", 2500)],
  ];
  for (const [index, band] of bands.entries()) {
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(config.eqDb?.[index] ?? 0);
    trim.connect(band[0]);
    chain([...band, gain]);
    gain.connect(sum);
  }
  const sweep = ctx.createBiquadFilter();
  if (config.filter) {
    sweep.type = config.filter.type;
    sweep.frequency.value = config.filter.frequency;
    sweep.Q.value = config.filter.qDb;
  } else {
    sweep.type = "lowpass";
    sweep.frequency.value = 20_000;
    sweep.Q.value = BUTTERWORTH_Q_DB;
  }
  sum.connect(sweep);
  return sweep;
}

function compressor(ctx) {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = -3;
  node.knee.value = 0;
  node.ratio.value = 20;
  node.attack.value = 0.003;
  node.release.value = 0.25;
  return node;
}

function sampleCeiling(ctx, ceiling = 0.794328) {
  const node = ctx.createWaveShaper();
  const curve = new Float32Array(65_537);
  for (let i = 0; i < curve.length; i++) {
    const input = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.max(-ceiling, Math.min(ceiling, input));
  }
  node.curve = curve;
  node.oversample = "none";
  return node;
}

async function truePeak(samples) {
  const factor = 4;
  const ctx = new OfflineAudioContext(1, samples.length * factor, SAMPLE_RATE * factor);
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  let peak = 0;
  for (const sample of rendered.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

async function metrics(samples) {
  const start = Math.floor(LEAD_SECONDS * SAMPLE_RATE);
  let peak = 0;
  let sumSquares = 0;
  for (let i = start; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / (samples.length - start));
  const tp = await truePeak(samples);
  return {
    samplePeak: peak,
    samplePeakDb: db(peak),
    truePeak: tp,
    truePeakDb: db(tp),
    rms,
    rmsDb: db(rms),
  };
}

const SCENARIOS = [
  { name: "one-full-neutral", channels: [{ signal: "full" }] },
  { name: "two-correlated-center", channels: [{ signal: "full" }, { signal: "full" }] },
  { name: "two-correlated-edge", channels: [{ signal: "full" }, { signal: "full", xfade: 0 }] },
  { name: "two-typical-center", channels: [{ signal: "typical-a" }, { signal: "typical-b" }] },
  { name: "one-full-trim-minus12", channels: [{ signal: "full", trimDb: -12 }] },
  { name: "one-full-proposed-neutral", channels: [{ signal: "full", trimDb: -6 }] },
  {
    name: "two-correlated-proposed-neutral",
    channels: [{ signal: "full", trimDb: -6 }, { signal: "full", trimDb: -6 }],
  },
  {
    name: "two-typical-proposed-neutral",
    channels: [{ signal: "typical-a", trimDb: -6 }, { signal: "typical-b", trimDb: -6 }],
  },
  {
    name: "one-full-neutral-master-plus6",
    channels: [{ signal: "full", trimDb: -6 }],
    master: dbToGain(6),
  },
  {
    name: "two-typical-neutral-master-plus6",
    channels: [{ signal: "typical-a", trimDb: -6 }, { signal: "typical-b", trimDb: -6 }],
    master: dbToGain(6),
  },
  { name: "one-full-trim-plus12", channels: [{ signal: "full", trimDb: 12 }] },
  { name: "one-full-eq-plus6", channels: [{ signal: "full", eqDb: [6, 6, 6] }] },
  {
    name: "one-full-filter-resonance",
    channels: [{ signal: "full", filter: { type: "highpass", frequency: 997, qDb: 3 } }],
  },
  ...[60, 250, 500, 997, 2500, 5000, 12000].map((frequency) => ({
    name: "flat-eq-" + frequency + "hz",
    channels: [{ signal: "full", frequency }],
  })),
];

async function renderScenario(scenario, rawPath) {
  const stages = [
    "decoded",
    "channel",
    "preMaster",
    "postMaster",
    "postCompressor",
    "postCompressorCeiling",
    "postBypassCeiling",
  ];
  const ctx = new OfflineAudioContext(stages.length, FRAMES, SAMPLE_RATE);
  const merger = ctx.createChannelMerger(stages.length);
  merger.channelInterpretation = "discrete";
  merger.connect(ctx.destination);

  const program = ctx.createGain();
  let firstSource = null;
  let firstChannel = null;
  for (const config of scenario.channels) {
    const buffer = ctx.createBuffer(1, FRAMES, SAMPLE_RATE);
    buffer.copyToChannel(signalData(config.signal, config.frequency, config.data), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const strip = channelStrip(ctx, source, config);
    const xfade = ctx.createGain();
    xfade.gain.value = config.xfade ?? 1;
    strip.connect(xfade);
    xfade.connect(program);
    source.start();
    firstSource ??= source;
    firstChannel ??= strip;
  }

  const master = ctx.createGain();
  master.gain.value = scenario.master ?? 1;
  program.connect(master);
  const limiter = compressor(ctx);
  master.connect(limiter);
  const ceiling = sampleCeiling(ctx);
  limiter.connect(ceiling);
  const bypassCeiling = sampleCeiling(ctx);
  master.connect(bypassCeiling);

  firstSource.connect(merger, 0, 0);
  firstChannel.connect(merger, 0, 1);
  program.connect(merger, 0, 2);
  master.connect(merger, 0, 3);
  limiter.connect(merger, 0, 4);
  ceiling.connect(merger, 0, 5);
  bypassCeiling.connect(merger, 0, 6);

  const rendered = await ctx.startRendering();
  const result = { name: scenario.name, stages: {} };
  for (const [index, stage] of stages.entries()) {
    result.stages[stage] = await metrics(rendered.getChannelData(index));
  }

  if (scenario.name === "two-typical-proposed-neutral") {
    const samples = rendered.getChannelData(6);
    const raw = Buffer.alloc(samples.length * 2 * 4);
    for (let i = 0; i < samples.length; i++) {
      raw.writeFloatLE(samples[i], i * 8);
      raw.writeFloatLE(samples[i], i * 8 + 4);
    }
    fs.writeFileSync(rawPath, raw);
  }
  return result;
}

async function loudTrackWindow(trackPath) {
  const raw = fs.readFileSync(trackPath);
  const encoded = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const decodeContext = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await decodeContext.decodeAudioData(encoded);
  const block = Math.max(1, Math.floor(decoded.sampleRate));
  let bestFrame = 0;
  let bestEnergy = -1;
  for (let start = 0; start < decoded.length; start += block) {
    const end = Math.min(decoded.length, start + block);
    let energy = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = start; i < end; i += 16) energy += data[i] * data[i];
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestFrame = start;
    }
  }
  const context = new OfflineAudioContext(1, FRAMES, SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = decoded;
  source.connect(context.destination);
  source.start(0, bestFrame / decoded.sampleRate, DURATION_SECONDS);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

ipcRenderer.on("run", async (_event, { rawPath, trackPaths }) => {
  try {
    const scenarios = [...SCENARIOS];
    const tracks = [];
    for (const trackPath of trackPaths) tracks.push(await loudTrackWindow(trackPath));
    for (const [index, data] of tracks.entries()) {
      scenarios.push({
        name: "real-track-" + (index + 1) + "-neutral",
        channels: [{ signal: "provided", data, trimDb: -6 }],
      });
    }
    if (tracks.length >= 2) {
      scenarios.push({
        name: "two-real-tracks-neutral",
        channels: [
          { signal: "provided", data: tracks[0], trimDb: -6 },
          { signal: "provided", data: tracks[1], trimDb: -6 },
        ],
      });
    }
    const results = [];
    for (const scenario of scenarios) results.push(await renderScenario(scenario, rawPath));
    ipcRenderer.send("done", { results });
  } catch (error) {
    ipcRenderer.send("failed", { message: error.stack || error.message });
  }
});
</script>`;

function decodedMetrics(filePath) {
  const decoded = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
    { maxBuffer: 20_000_000 },
  );
  let peak = 0;
  let sumSquares = 0;
  const count = decoded.length / 4;
  for (let offset = 0; offset < decoded.length; offset += 4) {
    const sample = decoded.readFloatLE(offset);
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / count);
  return { samplePeak: peak, samplePeakDb: 20 * Math.log10(peak), rms, rmsDb: 20 * Math.log10(rms) };
}

async function exportMetrics() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "manadj-master-export-"));
  try {
    const result = {};
    for (const format of ["wav", "mp3"]) {
      const outputPath = path.join(directory, `two-correlated.${format}`);
      await runFfmpeg(ffmpegRecordingArgs({
        rawPath: RAW_PATH,
        outputPath,
        sampleRate: SAMPLE_RATE,
        channels: 2,
        format,
      }));
      result[format] = decodedMetrics(outputPath);
    }
    return result;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function printTable(results, exported) {
  const f = (value) => Number.isFinite(value) ? value.toFixed(2).padStart(7) : "   -inf";
  console.log("scenario".padEnd(30), "stage".padEnd(16), "sample dBFS", "true dBTP", "RMS dBFS");
  for (const scenario of results) {
    for (const [stage, value] of Object.entries(scenario.stages)) {
      console.log(
        scenario.name.padEnd(30),
        stage.padEnd(16),
        f(value.samplePeakDb),
        f(value.truePeakDb),
        f(value.rmsDb),
      );
    }
  }
  for (const [format, value] of Object.entries(exported)) {
    console.log("two-typical-proposed-neutral".padEnd(30), `export-${format}`.padEnd(16), f(value.samplePeakDb), "    n/a", f(value.rmsDb));
  }
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await window.loadURL(`data:text/html;base64,${Buffer.from(HTML).toString("base64")}`);
  window.webContents.send("run", { rawPath: RAW_PATH, trackPaths: TRACK_PATHS });
});

ipcMain.once("failed", (_event, error) => {
  console.error(error.message);
  app.exit(1);
});

ipcMain.once("done", async (_event, { results }) => {
  try {
    const exported = await exportMetrics();
    if (JSON_OUTPUT) console.log(JSON.stringify({ results, exported }, null, 2));
    else printTable(results, exported);
  } catch (error) {
    console.error(error.stack || error.message);
    app.exitCode = 1;
  } finally {
    fs.rmSync(RAW_PATH, { force: true });
    app.quit();
  }
});

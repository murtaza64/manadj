#!/usr/bin/env node
/*
 * Sweep-filter resonance ceiling probe (sweep-filter #270).
 *
 * Renders a full-scale bass tone through the production channel chain
 * (neutral -6 dB trim -> flat LR4 isolator -> the REAL createSweepFilter
 * bundled from frontend/src/playback/sweepFilter.ts -> master ->
 * compressor -> -2 dBFS sample ceiling, ADR 0034) at several sweep
 * positions, in Electron's OfflineAudioContext. Per position it renders
 * both a fixed 55 Hz bass fundamental and the worst-case tone sitting on
 * the cascade's measured resonant hump.
 *
 * Asserts: with DEFAULT_FILTER_SETTINGS the post-ceiling peak never
 * reaches the ceiling (the ceiling stays disengaged; no flattening/buzz).
 * A "legacy" column replays the pre-#270 compensation (trim - resonance x
 * 0.15) for comparison; it is informational, not asserted.
 *
 *   cd desktop
 *   npx electron ../scripts/probes/sweep_filter_ceiling.js [--json]
 *
 * Exit code 1 if any asserted scenario touches the ceiling.
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const JSON_OUTPUT = process.argv.includes("--json");
const SAMPLE_RATE = 48_000;

function bundleSweepFilter() {
  const frontend = path.join(__dirname, "../../frontend");
  const esbuild = path.join(frontend, "node_modules/.bin/esbuild");
  const entry = path.join(
    os.tmpdir(),
    `manadj-sweep-probe-entry-${process.pid}.ts`,
  );
  fs.writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(frontend, "src/playback/sweepFilter.ts"))};\n` +
      `export * from ${JSON.stringify(path.join(frontend, "src/playback/filterSettings.ts"))};\n`,
  );
  try {
    return execFileSync(
      esbuild,
      [
        entry,
        "--bundle",
        "--format=iife",
        "--global-name=sweep",
        '--define:import.meta.env.VITE_API_URL=""',
        "--log-level=error",
      ],
      { encoding: "utf8", maxBuffer: 20_000_000 },
    ).replace(/<\/script>/g, "<\\/script>");
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

const PROBE = String.raw`
const { ipcRenderer } = require("electron");
const SAMPLE_RATE = ${SAMPLE_RATE};
const DURATION_SECONDS = 1.5;
const LEAD_SECONDS = 0.25;
const FRAMES = SAMPLE_RATE * DURATION_SECONDS;
const CEILING = 0.794328; // -2 dBFS (ADR 0034)
const NEUTRAL_TRIM_DB = -6;
const BUTTERWORTH_Q_DB = -3.0103;
const LEGACY_NOMINAL_FRACTION = 0.15;

function dbToGain(db) { return 10 ** (db / 20); }
function db(value) { return value > 0 ? 20 * Math.log10(value) : -Infinity; }

function toneData(frequency) {
  const data = new Float32Array(FRAMES);
  const lead = Math.floor(LEAD_SECONDS * SAMPLE_RATE);
  for (let frame = lead; frame < FRAMES; frame++) {
    data[frame] = Math.sin(2 * Math.PI * frequency * ((frame - lead) / SAMPLE_RATE));
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

/** Neutral trim + flat LR4 isolator, as in master_gain_staging.js. */
function preFilterStrip(ctx, source) {
  const trim = ctx.createGain();
  trim.gain.value = dbToGain(NEUTRAL_TRIM_DB);
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
  for (const band of bands) {
    trim.connect(band[0]);
    chain(band);
    band[band.length - 1].connect(sum);
  }
  return sum;
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

function sampleCeiling(ctx) {
  const node = ctx.createWaveShaper();
  const curve = new Float32Array(65_537);
  for (let i = 0; i < curve.length; i++) {
    const input = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.max(-CEILING, Math.min(CEILING, input));
  }
  node.curve = curve;
  node.oversample = "none";
  return node;
}

function masterTail(ctx, from) {
  const master = ctx.createGain();
  from.connect(master);
  const limiter = compressor(ctx);
  master.connect(limiter);
  const ceiling = sampleCeiling(ctx);
  limiter.connect(ceiling);
  return { master, ceiling };
}

function peakDb(samples) {
  const start = Math.floor((LEAD_SECONDS + 0.25) * SAMPLE_RATE);
  let peak = 0;
  for (let i = start; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return { peak, peakDb: db(peak) };
}

/** Frequency where the swept response peaks (worst-case tone). */
function humpFrequency(settings, position) {
  const grid = Float32Array.from({ length: 2048 }, (_, i) => 10 * 2390 ** (i / 2047));
  const response = sweep.sweepResponseDb(settings, position, grid, SAMPLE_RATE);
  let best = 0;
  for (let i = 1; i < response.length; i++) if (response[i] > response[best]) best = i;
  return grid[best];
}

async function renderScenario(settings, position, toneHz) {
  const stages = ["postSweep", "postCeiling", "legacyPostSweep", "legacyPostCeiling"];
  const ctx = new OfflineAudioContext(stages.length, FRAMES, SAMPLE_RATE);
  const merger = ctx.createChannelMerger(stages.length);
  merger.channelInterpretation = "discrete";
  merger.connect(ctx.destination);

  const buffer = ctx.createBuffer(1, FRAMES, SAMPLE_RATE);
  buffer.copyToChannel(toneData(toneHz), 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const eq = preFilterStrip(ctx, source);

  // Production sweep filter, bundled straight from frontend sources.
  const filter = sweep.createSweepFilter(ctx);
  eq.connect(filter.input);
  filter.update(settings, position, true);
  const d = sweep.describeSweepFilter(settings, position, SAMPLE_RATE);

  // Legacy pre-#270 compensation for comparison: trim - resonance x 0.15
  // applied as a post-filter delta (exact while the path is fully wet).
  const legacyGainDb = settings.trim - settings.resonance * LEGACY_NOMINAL_FRACTION;
  const legacyDelta = ctx.createGain();
  legacyDelta.gain.value = dbToGain(legacyGainDb - d.gainDb);
  filter.output.connect(legacyDelta);

  const tail = masterTail(ctx, filter.output);
  const legacyTail = masterTail(ctx, legacyDelta);
  filter.output.connect(merger, 0, 0);
  tail.ceiling.connect(merger, 0, 1);
  legacyDelta.connect(merger, 0, 2);
  legacyTail.ceiling.connect(merger, 0, 3);

  source.start();
  const rendered = await ctx.startRendering();
  const result = { position, toneHz, type: d.type, cutoff: d.frequency, gainDb: d.gainDb };
  for (const [index, stage] of stages.entries()) {
    result[stage] = peakDb(rendered.getChannelData(index));
  }
  return result;
}

ipcRenderer.on("run", async () => {
  try {
    const settings = sweep.DEFAULT_FILTER_SETTINGS;
    const positions = [0.08, 0.12, 0.15, 0.19, 0.25, 0.4, 0.7, 1, -0.5, -0.85, -1];
    const results = [];
    for (const position of positions) {
      results.push(await renderScenario(settings, position, 55));
      const worst = humpFrequency(settings, position);
      results.push(await renderScenario(settings, position, worst));
    }
    ipcRenderer.send("done", { results });
  } catch (error) {
    ipcRenderer.send("failed", { message: error.stack || error.message });
  }
});
`;

const CEILING_DB = 20 * Math.log10(0.794328);

function report(results) {
  const failures = [];
  const f = (value) =>
    Number.isFinite(value) ? value.toFixed(2).padStart(7) : "   -inf";
  if (!JSON_OUTPUT) {
    console.log(
      "position".padStart(8),
      "tone Hz".padStart(8),
      "filter".padEnd(14),
      "postSweep".padStart(9),
      "postCeil".padStart(9),
      "legacySweep".padStart(11),
      "legacyCeil".padStart(10),
      "verdict".padStart(8),
    );
  }
  for (const r of results) {
    // Under the ceiling means the waveshaper never flattened a sample.
    const clean = r.postCeiling.peak < 0.794328 - 1e-3;
    if (!clean) failures.push(r);
    if (!JSON_OUTPUT) {
      console.log(
        String(r.position).padStart(8),
        r.toneHz.toFixed(0).padStart(8),
        `${r.type === "lowpass" ? "LP" : "HP"} ${Math.round(r.cutoff)} Hz`.padEnd(14),
        f(r.postSweep.peakDb),
        f(r.postCeiling.peakDb),
        f(r.legacyPostSweep.peakDb),
        f(r.legacyPostCeiling.peakDb),
        clean ? "   clean" : " CEILING",
      );
    }
  }
  if (JSON_OUTPUT) console.log(JSON.stringify({ ceilingDb: CEILING_DB, results }, null, 2));
  else {
    console.log(
      `\nceiling ${CEILING_DB.toFixed(2)} dBFS; legacy columns replay the pre-#270 nominal compensation.`,
    );
    console.log(
      failures.length
        ? `FAIL: ${failures.length} scenario(s) hit the ceiling`
        : "PASS: no scenario hit the ceiling",
    );
  }
  return failures.length === 0;
}

app.whenReady().then(async () => {
  const html = `<!doctype html><script>${bundleSweepFilter()}</script><script>${PROBE}</script>`;
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await window.loadURL(
    `data:text/html;base64,${Buffer.from(html).toString("base64")}`,
  );
  window.webContents.send("run", {});
});

ipcMain.once("failed", (_event, error) => {
  console.error(error.message);
  app.exit(1);
});

ipcMain.once("done", (_event, { results }) => {
  const ok = report(results);
  app.exitCode = ok ? 0 : 1;
  app.quit();
});

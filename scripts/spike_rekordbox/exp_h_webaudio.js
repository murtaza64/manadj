// Experiment H: WebAudio (Chromium/Electron) decode frame per container
// class, vs manadj's ffmpeg frame.
//
// Runs inside Electron (same Chromium family as the manadj desktop
// shell). For each spike-offset file: decodeAudioData -> mono 44.1k via
// OfflineAudioContext resample -> cross-correlate a 10 s window against
// the ffmpeg-decoded flac reference (/tmp/spike-ref-flac.f32, 30s-40s).
// offset > 0: event sits LATER in the WebAudio timeline than in the
// ffmpeg flac frame. Compare to exp F/G table.
//
//   cd desktop && npx electron ../scripts/spike_rekordbox/exp_h_webaudio.js
//
// (Renderer does the decoding; results print to stdout via IPC.)

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");

const FILES = [
  ["flac (control)", null], // decoded from the same flac as the reference
  ["mp3 A (no Xing)", "stars caseA nox.mp3"],
  ["mp3 B (no LAME)", "stars caseX ffmpeg.mp3"],
  ["mp3 C (bad CRC)", "stars caseC badcrc.mp3"],
  ["mp3 D (LAME+CRC)", "stars caseD lame.mp3"],
  ["m4a Lavf no-SMPB", "stars m4a lavf.m4a"],
  ["m4a CoreAudio SMPB", "stars m4a coreaudio.m4a"],
];

const HTML = `<!doctype html><script>
const { ipcRenderer } = require("electron");
const fs = require("fs");
const SR = 44100, START = 30, DUR = 10, MAX_LAG = Math.round(0.2 * SR);

function xcorrOffsetMs(ref, sig) {
  // time-domain, coarse-to-fine: coarse at 1ms steps, fine at 1 sample
  const n = Math.min(ref.length, sig.length);
  let mr = 0, ms = 0;
  for (let i = 0; i < n; i++) { mr += ref[i]; ms += sig[i]; }
  mr /= n; ms /= n;
  const score = (lag, step) => {
    let s = 0;
    for (let i = Math.max(0, -lag); i < n - Math.max(0, lag); i += step)
      s += (ref[i] - mr) * (sig[i + lag] - ms);
    return s;
  };
  let best = 0, bestS = -Infinity;
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 44) {
    const s = score(lag, 16);
    if (s > bestS) { bestS = s; best = lag; }
  }
  let fineBest = best; bestS = -Infinity;
  for (let lag = best - 66; lag <= best + 66; lag++) {
    const s = score(lag, 4);
    if (s > bestS) { bestS = s; fineBest = lag; }
  }
  return fineBest / SR * 1000;
}

async function decodeWindow(p) {
  const buf = fs.readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const ac = new OfflineAudioContext(1, 1, SR);
  const decoded = await ac.decodeAudioData(ab);
  // mixdown + resample to mono 44.1k over [START, START+DUR]
  const oac = new OfflineAudioContext(1, DUR * SR, SR);
  const src = oac.createBufferSource();
  src.buffer = decoded;
  src.connect(oac.destination);
  src.start(0, START, DUR);
  const rendered = await oac.startRendering();
  return rendered.getChannelData(0);
}

ipcRenderer.on("run", async (_e, { files, refPath, flacPath, sink }) => {
  const raw = fs.readFileSync(refPath);
  const ref = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const out = [];
  for (const [label, p] of files) {
    try {
      const sig = await decodeWindow(p ?? flacPath);
      out.push([label, xcorrOffsetMs(ref, sig)]);
    } catch (err) {
      out.push([label, "ERR " + err.message]);
    }
  }
  fs.writeFileSync(sink, JSON.stringify(out));
  ipcRenderer.send("done");
});
</script>`;

app.whenReady().then(async () => {
  const flacPath = require("child_process")
    .execSync("ls \"$HOME/Music/Tracks/\" | grep -i 'Stars (2025).*flac'")
    .toString().trim();
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  const sink = path.join(os.tmpdir(), "exp_h_results.json");
  await win.loadURL("data:text/html;base64," + Buffer.from(HTML).toString("base64"));
  win.webContents.send("run", {
    files: FILES.map(([l, f]) => [l, f && path.join(os.homedir(), "Music/spike-offset", f)]),
    refPath: "/tmp/spike-ref-flac.f32",
    flacPath: path.join(os.homedir(), "Music/Tracks", flacPath),
    sink,
  });
  ipcMain.on("done", () => {
    const res = JSON.parse(require("fs").readFileSync(sink));
    for (const [label, off] of res)
      console.log(
        label.padEnd(20),
        typeof off === "number" ? (off >= 0 ? "+" : "") + off.toFixed(2) + " ms" : off,
      );
    app.quit();
  });
});

"""Drop-detection shootout report (structure-analysis 01).

Reads data/drop_results.json (written by harness.run_drops) and emits a
self-contained HTML comparison page: summary table, then one row per track
with the 3-band energy strip, the curated slot-4 Drop cue (ground truth),
and every candidate's ranked hypotheses. Audio per row via file:// URLs
(review_page.py precedent); click the strip to seek.

Usage:
    uv run -m harness.drop_report && open data/drop_report.html
"""

from __future__ import annotations

from pathlib import Path

RESULTS = Path("data/drop_results.json")
OUT = Path("data/drop_report.html")

PAGE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>manadj — drop detection shootout</title>
<style>
  :root {
    --bg: #0d0d12; --card: #17171f; --text: #f2f2f7; --gt: #ffe600;
    --c0: #ff2d78; --c1: #aaff00; --c2: #00e5ff; --c3: #ffb300;
  }
  body { background: var(--bg); color: var(--text);
         font: 14px/1.5 -apple-system, "SF Pro", Helvetica, sans-serif;
         max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: .3rem .9rem; text-align: right; }
  th { border-bottom: 2px solid #333; }
  td:first-child, th:first-child { text-align: left; font-weight: 700; }
  tr:nth-child(even) { background: #14141b; }
  .row { background: var(--card); border-radius: 10px; padding: .8rem 1rem;
         margin: .8rem 0; }
  .name { font-weight: 600; word-break: break-all; }
  .meta { color: #888; font-size: .8rem; margin-bottom: .3rem; }
  canvas { width: 100%; height: 110px; display: block; border-radius: 6px;
           background: #0a0a0e; cursor: crosshair; }
  audio { width: 100%; height: 28px; margin-top: .4rem; }
  .jumps { margin-top: .3rem; display: flex; gap: .4rem; flex-wrap: wrap; }
  .jumps button { border: 1px solid; border-radius: 6px; background: none;
    color: inherit; padding: .1rem .55rem; font-weight: 700; cursor: pointer;
    font-size: .75rem; }
  .legend span { margin-right: 1.2rem; font-weight: 700; }
  .controls { display: flex; gap: .8rem; align-items: center; margin: 1rem 0;
              flex-wrap: wrap; }
  select, .controls input { background: #101018; color: var(--text);
    border: 1px solid #444; border-radius: 6px; padding: .3rem .5rem; }
  .hitmark { font-weight: 700; }
</style>
</head>
<body>
<h1>Drop detection shootout — slot-4 Hot Cue as ground truth</h1>
<p id="blurb"></p>
<table id="summary"></table>
<p class="legend" id="legend"></p>
<div class="controls">
  <label>ranking <select id="selRank">
    <option value="early">early (earliest-strong)</option>
    <option value="raw">raw score</option>
  </select></label>
  <label>candidate <select id="selCand"></select></label>
  <label>show <select id="selFilter">
    <option value="all">all tracks</option>
    <option value="miss1">top-1 misses (±1 bar)</option>
    <option value="miss3">top-3 misses (±1 bar)</option>
    <option value="hit1">top-1 hits (±1 bar)</option>
  </select></label>
  <label>sort <select id="selSort">
    <option value="name">name</option>
    <option value="err">top-1 error desc</option>
  </select></label>
  <input id="search" placeholder="filter by name…">
  <span id="count"></span>
</div>
<div id="rows"></div>

<script>
const DATA = __DATA__;
const COLORS = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)'];
const RAW_COLORS = ['#ff2d78', '#aaff00', '#00e5ff', '#ffb300'];
const CANDS = DATA.candidates;
const STRIP_COLORS = ['#ff4422', '#22cc66', '#66bbff'];  // low / mid / high

document.getElementById('blurb').textContent =
  `${DATA.n_tracks} tracks (slot-4 cue + Beatgrid + waveform blob). ` +
  `Headline: top-1 hypothesis within ±1 bar of the curated slot-4 Drop cue. ` +
  `hit@k = any of the top k hypotheses within ±1 bar (multi-drop leniency). ` +
  `"early" re-ranks each candidate's hypotheses earliest-strong-first ` +
  `(slot 4 marks the first drop; alpha=${DATA.alpha}).`;

// summary table: raw vs early side by side
{
  const pct = v => (v * 100).toFixed(1) + '%';
  let html = '<tr><th>candidate</th><th>hit@1 raw</th><th>hit@1 early</th>' +
             '<th>hit@3 raw</th><th>hit@3 early</th><th>hit@5</th>' +
             '<th>med err raw</th><th>med err early</th></tr>';
  CANDS.forEach((c, i) => {
    const r = DATA.summary.raw[c], e = DATA.summary.early[c];
    html += `<tr><td style="color:${RAW_COLORS[i]}">${c}</td>` +
      `<td>${pct(r.hit1_1bar)}</td><td><b>${pct(e.hit1_1bar)}</b></td>` +
      `<td>${pct(r.hit3_1bar)}</td><td>${pct(e.hit3_1bar)}</td>` +
      `<td>${pct(r.hit5_1bar)}</td>` +
      `<td>${r.median_err_bars}</td><td>${e.median_err_bars}</td></tr>`;
  });
  document.getElementById('summary').innerHTML = html;
  document.getElementById('legend').innerHTML =
    `<span style="color:var(--gt)">▮ slot-4 cue (truth)</span>` +
    CANDS.map((c, i) =>
      `<span style="color:${RAW_COLORS[i]}">▼ ${c}</span>`).join('');
}

function ranking() { return document.getElementById('selRank').value; }
function orderOf(p) {
  return ranking() === 'early' ? p.early_order : p.hyps.map((_, i) => i);
}

const selCand = document.getElementById('selCand');
CANDS.forEach(c => selCand.add(new Option(c, c)));
selCand.value = 'phrase_bass_drop';

function decodeStrip(t) {
  const bytes = Uint8Array.from(atob(t.strip.b64), ch => ch.charCodeAt(0));
  return { cols: t.strip.cols, rows: 3, bytes };
}

function drawRow(t, canvas) {
  const { cols, bytes } = decodeStrip(t);
  const W = canvas.width = canvas.clientWidth * devicePixelRatio;
  const H = canvas.height = 110 * devicePixelRatio;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const x2px = x => x / t.duration * W;

  // 3-band energy, drawn widest-first so low sits behind mid behind high
  const bandH = H - 26 * devicePixelRatio;
  const base = H;
  for (let r = 0; r < 3; r++) {
    g.fillStyle = STRIP_COLORS[r];
    g.globalAlpha = [0.9, 0.75, 0.8][r];
    const colW = W / cols;
    for (let x = 0; x < cols; x++) {
      const v = bytes[r * cols + x] / 255;
      const h = v * bandH * [1, 0.72, 0.45][r];
      g.fillRect(x * colW, base - h, Math.max(colW, 1), h);
    }
  }
  g.globalAlpha = 1;

  // phrase ticks (every 8 bars)
  g.strokeStyle = 'rgba(255,255,255,0.13)';
  g.lineWidth = 1;
  t.phrase_ticks.forEach(pt => {
    const x = x2px(pt);
    g.beginPath(); g.moveTo(x, 26 * devicePixelRatio); g.lineTo(x, H); g.stroke();
  });

  // candidate hypotheses: triangles in per-candidate lanes, opacity by
  // display rank under the selected ranking
  CANDS.forEach((c, i) => {
    const laneY = (4 + i * 5.5) * devicePixelRatio;
    g.fillStyle = RAW_COLORS[i];
    const hyps = t.preds[c].hyps || [];
    orderOf(t.preds[c]).forEach((hi, rank) => {
      const x = x2px(hyps[hi][0]);
      g.globalAlpha = [1, 0.6, 0.45, 0.35, 0.3][rank] ?? 0.3;
      const s = (rank === 0 ? 5 : 3.5) * devicePixelRatio;
      g.beginPath();
      g.moveTo(x, laneY); g.lineTo(x - s, laneY + s * 1.6);
      g.lineTo(x + s, laneY + s * 1.6); g.closePath(); g.fill();
      if (rank === 0) {
        g.globalAlpha = 0.85;
        g.fillRect(x - devicePixelRatio / 2, laneY, devicePixelRatio, H - laneY);
      }
    });
    g.globalAlpha = 1;
  });

  // ground truth: slot-4 cue
  const gx = x2px(t.gt);
  g.fillStyle = '#ffe600';
  g.fillRect(gx - devicePixelRatio, 0, 2 * devicePixelRatio, H);
  // ±1 bar tolerance band
  g.globalAlpha = 0.18;
  g.fillRect(x2px(t.gt - t.bar), 0, x2px(t.gt + t.bar) - x2px(t.gt - t.bar), H);
  g.globalAlpha = 1;

  // cache the finished frame so the playhead can blit over it
  canvas._base = g.getImageData(0, 0, W, H);
}

// ---- playhead ----
function paintPlayhead(canvas, time, duration) {
  if (!canvas._base) return;
  const g = canvas.getContext('2d');
  g.putImageData(canvas._base, 0, 0);
  const x = time / duration * canvas.width;
  const s = 5 * devicePixelRatio;
  g.fillStyle = '#ffffff';
  g.fillRect(x - devicePixelRatio / 2, 0, devicePixelRatio, canvas.height);
  g.beginPath();
  g.moveTo(x - s, 0); g.lineTo(x + s, 0); g.lineTo(x, s * 1.4);
  g.closePath(); g.fill();
}

function ensureDrawn(t, canvas) {
  if (!canvas._drawn) {
    canvas._drawn = true;
    drawRow(t, canvas);
  }
}

function startPlayhead(t, canvas, audio) {
  ensureDrawn(t, canvas);
  cancelAnimationFrame(canvas._raf);
  const tick = () => {
    paintPlayhead(canvas, audio.currentTime, t.duration);
    if (!audio.paused && !audio.ended) canvas._raf = requestAnimationFrame(tick);
  };
  canvas._raf = requestAnimationFrame(tick);
}

function makeRow(t) {
  const div = document.createElement('div');
  div.className = 'row';
  const cand = selCand.value;
  const p = t.preds[cand];
  const m = p.m[ranking()];
  const hit = m.hit1_1bar ? '<span class="hitmark" style="color:#aaff00">hit</span>'
    : m.hit3_1bar ? '<span class="hitmark" style="color:#ffb300">top-3</span>'
    : '<span class="hitmark" style="color:#ff2d78">miss</span>';
  div.innerHTML = `
    <div class="name">${t.name}</div>
    <div class="meta">${t.bpm.toFixed(1)} BPM · bar ${t.bar.toFixed(2)}s ·
      grid ${t.grid_origin} · cue4 @ ${t.gt.toFixed(1)}s ·
      ${cand} (${ranking()}): err ${m.err_bars_top1 ?? '—'} bars ${hit}</div>
    <canvas></canvas>
    <audio controls preload="none" src="file://${encodeURI(t.path)}"></audio>
    <div class="jumps">
      <button style="border-color:var(--gt);color:var(--gt)"
        onclick="seek(this, ${t.gt})">cue 4 ${fmtT(t.gt)}</button>
      ${CANDS.map((c, i) => {
        const h = t.preds[c].hyps;
        if (!h.length) return '';
        const top1 = h[orderOf(t.preds[c])[0]][0];
        return `<button style="border-color:${RAW_COLORS[i]};color:${RAW_COLORS[i]}"
          onclick="seek(this, ${top1})">${c} ${fmtT(top1)}</button>`;
      }).join('')}
    </div>`;
  const canvas = div.querySelector('canvas');
  const audio = div.querySelector('audio');
  canvas.onclick = e => {
    const r = canvas.getBoundingClientRect();
    audio.currentTime = (e.clientX - r.left) / r.width * t.duration;
    audio.play();
  };
  audio.onplay = () => startPlayhead(t, canvas, audio);
  audio.onseeked = () => { ensureDrawn(t, canvas);
                           paintPlayhead(canvas, audio.currentTime, t.duration); };
  observer.observe(canvas);
  canvas._track = t;
  return div;
}

function fmtT(s) {
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}
function seek(btn, time) {
  const audio = btn.closest('.row').querySelector('audio');
  audio.currentTime = time;
  audio.play();
}

// lazy canvas rendering
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting && !e.target._drawn) {
      e.target._drawn = true;
      drawRow(e.target._track, e.target);
    }
  });
}, { rootMargin: '400px' });

function render() {
  const cand = selCand.value;
  const filter = document.getElementById('selFilter').value;
  const sort = document.getElementById('selSort').value;
  const q = document.getElementById('search').value.toLowerCase();
  const rk = ranking();
  let ts = DATA.tracks.filter(t => {
    const m = t.preds[cand].m[rk];
    if (filter === 'miss1' && m.hit1_1bar) return false;
    if (filter === 'miss3' && m.hit3_1bar) return false;
    if (filter === 'hit1' && !m.hit1_1bar) return false;
    if (q && !t.name.toLowerCase().includes(q)) return false;
    return true;
  });
  if (sort === 'err') {
    ts = ts.slice().sort((a, b) =>
      (b.preds[cand].m[rk].err_bars_top1 ?? -1) -
      (a.preds[cand].m[rk].err_bars_top1 ?? -1));
  } else {
    ts = ts.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  document.getElementById('count').textContent = `${ts.length} tracks`;
  const container = document.getElementById('rows');
  container.replaceChildren();
  ts.forEach(t => container.appendChild(makeRow(t)));
}

['selRank', 'selCand', 'selFilter', 'selSort'].forEach(id =>
  document.getElementById(id).onchange = render);
document.getElementById('search').oninput = render;
render();
</script>
</body>
</html>
"""


def main() -> None:
    data = RESULTS.read_text()
    # </ must not terminate the <script> block (review_page.py precedent).
    OUT.write_text(PAGE.replace("__DATA__", data.replace("</", "<\\/")))
    print(f"report -> {OUT}  (open with: open {OUT})")


if __name__ == "__main__":
    main()

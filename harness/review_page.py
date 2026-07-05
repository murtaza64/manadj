"""Generate a local review page for the disputed verification sample.

Reads data/disputed_sample.json (written by harness.report) and emits a
self-contained HTML page with an audio player per track, the competing
values, verdict pickers, and a copyable overrides.toml snippet.

Usage:
    uv run -m harness.review_page && open data/review.html
"""

from __future__ import annotations

import json
from pathlib import Path

SAMPLE = Path("data/disputed_sample.json")
OUT = Path("data/review.html")

PAGE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>manadj — disputed ground truth review</title>
<style>
  :root {{
    --bg: #0d0d12; --card: #17171f; --text: #f2f2f7;
    --engine: #00e5ff; --rb: #ff2d78; --third: #aaff00; --custom: #ffb300;
  }}
  body {{ background: var(--bg); color: var(--text);
         font: 15px/1.5 -apple-system, "SF Pro", Helvetica, sans-serif;
         max-width: 900px; margin: 2rem auto; padding: 0 1rem; }}
  h1 {{ font-size: 1.4rem; }}
  .row {{ background: var(--card); border-radius: 10px; padding: 1rem;
          margin: 1rem 0; }}
  .name {{ font-weight: 600; margin-bottom: .4rem; word-break: break-all; }}
  .field {{ display: inline-block; font-size: .75rem; font-weight: 700;
            text-transform: uppercase; padding: .1rem .5rem;
            border-radius: 4px; background: #2f2f3d; margin-right: .5rem; }}
  audio {{ width: 100%; margin: .5rem 0; }}
  .choices {{ display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .5rem; }}
  .choices button {{ border: 2px solid; border-radius: 8px; background: none;
    color: inherit; padding: .35rem .8rem; font-weight: 700; cursor: pointer; }}
  .choices button.engine {{ border-color: var(--engine); color: var(--engine); }}
  .choices button.rb {{ border-color: var(--rb); color: var(--rb); }}
  .choices button.third {{ border-color: var(--third); color: var(--third); }}
  .choices button.skip {{ border-color: #555; color: #999; }}
  .choices button.picked {{ color: #000 !important; }}
  .choices button.engine.picked {{ background: var(--engine); }}
  .choices button.rb.picked {{ background: var(--rb); }}
  .choices button.third.picked {{ background: var(--third); }}
  .choices button.skip.picked {{ background: #555; color: #fff !important; }}
  .choices input {{ background: #101018; border: 2px solid var(--custom);
    border-radius: 8px; color: var(--custom); padding: .35rem .6rem;
    width: 7rem; font-weight: 700; }}
  .tap {{ border: 2px dashed #666 !important; color: #ccc !important; }}
  pre {{ background: #101018; border-radius: 10px; padding: 1rem;
         white-space: pre-wrap; word-break: break-all; }}
  .legend span {{ margin-right: 1rem; font-weight: 700; }}
</style>
</head>
<body>
<h1>Disputed ground truth — verify by ear</h1>
<p class="legend">
  <span style="color: var(--engine)">Engine</span>
  <span style="color: var(--rb)">Rekordbox</span>
  <span style="color: var(--third)">madmom (3rd opinion)</span>
  <span style="color: var(--custom)">custom</span>
</p>
<p>Pick a verdict per row (or type your own; BPM rows have a tap pad).
The overrides snippet at the bottom updates live — paste it into
<code>.scratch/native-analysis-accuracy/overrides.toml</code>.</p>
<div id="rows"></div>
<h2>overrides.toml</h2>
<pre id="toml">(no verdicts yet)</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('toml').textContent)"
        style="font-size:1rem;padding:.5rem 1rem;border-radius:8px;
               background:var(--third);border:none;font-weight:700;cursor:pointer">
  Copy to clipboard</button>

<script>
const ROWS = {rows_json};
const verdicts = {{}};

function pick(i, value, btn) {{
  verdicts[i] = value;
  const row = document.getElementById('row' + i);
  row.querySelectorAll('button').forEach(b => b.classList.remove('picked'));
  if (btn) btn.classList.add('picked');
  renderToml();
}}

function renderToml() {{
  const byFile = {{}};
  ROWS.forEach((r, i) => {{
    const v = verdicts[i];
    if (v === undefined || v === null || v === '' || v === 'SKIP') return;
    (byFile[r.filename] ||= {{}})[r.field] = v;
  }});
  const chunks = Object.entries(byFile).map(([f, fields]) => {{
    let out = '["' + f + '"]';
    if (fields.key !== undefined) out += '\\nkey = "' + fields.key + '"';
    if (fields.bpm !== undefined) out += '\\nbpm = ' + fields.bpm;
    return out;
  }});
  document.getElementById('toml').textContent =
    chunks.length ? chunks.join('\\n\\n') : '(no verdicts yet)';
}}

// tap-BPM per row
const taps = {{}};
function tap(i, el) {{
  const now = performance.now();
  (taps[i] ||= []).push(now);
  const t = taps[i].filter(x => now - x < 12000).slice(-16);
  taps[i] = t;
  if (t.length >= 4) {{
    const iv = [];
    for (let j = 1; j < t.length; j++) iv.push(t[j] - t[j-1]);
    const bpm = 60000 / (iv.reduce((a, b) => a + b, 0) / iv.length);
    el.textContent = 'tap: ' + bpm.toFixed(1);
  }} else {{
    el.textContent = 'tap ' + t.length + '…';
  }}
}}

const container = document.getElementById('rows');
ROWS.forEach((r, i) => {{
  const div = document.createElement('div');
  div.className = 'row';
  div.id = 'row' + i;
  const name = r.filename.split('/').pop();
  const third = r.third === null ? '' : r.third;
  const isBpm = r.field === 'bpm';
  const fmt = v => isBpm && typeof v === 'number' ? +v.toFixed(2) : v;
  div.innerHTML = `
    <div class="name"><span class="field">${{r.field}}</span>${{name}}</div>
    <audio controls preload="none" src="file://${{encodeURI(r.filename)}}"></audio>
    <div class="choices">
      <button class="engine" onclick="pick(${{i}}, ${{JSON.stringify(fmt(r.engine))}}, this)">
        Engine: ${{fmt(r.engine)}}</button>
      <button class="rb" onclick="pick(${{i}}, ${{JSON.stringify(fmt(r.rb))}}, this)">
        RB: ${{fmt(r.rb)}}</button>
      ${{third !== '' && third !== 'bail' && third !== 'error' ?
        `<button class="third" onclick="pick(${{i}}, ${{JSON.stringify(fmt(r.third))}}, this)">
           madmom: ${{fmt(r.third)}}</button>` :
        `<span style="color:#777;align-self:center">madmom: ${{third || 'n/a'}}</span>`}}
      <input placeholder="custom" onchange="pick(${{i}},
        ${{isBpm}} ? parseFloat(this.value) : this.value, null)">
      ${{isBpm ? `<button class="tap" onclick="tap(${{i}}, this)">tap…</button>` : ''}}
      <button class="skip" onclick="pick(${{i}}, 'SKIP', this)">skip</button>
    </div>`;
  container.appendChild(div);
}});
</script>
</body>
</html>
"""


def main() -> None:
    rows = json.loads(SAMPLE.read_text())
    # </ must not terminate the <script> block; JSON needs no HTML escaping
    # inside a script element otherwise.
    rows_json = json.dumps(rows).replace("</", "<\\/")
    OUT.write_text(PAGE.format(rows_json=rows_json))
    print(f"review page -> {OUT}  (open with: open {OUT})")


if __name__ == "__main__":
    main()

"""Serve only USB verification screenshots and results on localhost."""

import argparse
import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EVIDENCE = Path(__file__).resolve().parents[2] / "data/usb-verification"
IMAGES = {
    "final-preview-reported-track.png": "Reported track: deck overview and browser preview fixed",
    "final-browser-previews.png": "Browser previews: first tracks, before loading a deck",
    "final-previews-last.png": "Browser previews: tracks 60 through 74",
    "final-mp3.png": "MP3 playback, grid and cues",
    "final-aac.png": "M4A/AAC playback, grid and cues",
    "final-hotcue.png": "Hot cue C: 44.161 seconds",
    "final-variable-slow.png": "Variable grid: 134.18 BPM",
    "final-variable-fast.png": "Variable grid: 170.00 BPM",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.lstrip("/")
        if name in IMAGES:
            content, kind = (EVIDENCE / name).read_bytes(), "image/png"
        elif name == "source-check.json":
            content, kind = (EVIDENCE / name).read_bytes(), "application/json"
        elif name == "":
            result = json.loads((EVIDENCE / "source-check.json").read_text())
            stats = html.escape(json.dumps(result, indent=2))
            images = "".join(
                f'<figure><figcaption>{caption}</figcaption><a href="/{file}">'
                f'<img src="/{file}" alt="{caption}" loading="lazy"></a></figure>'
                for file, caption in IMAGES.items()
            )
            content = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>manadj USB Verification</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#111;color:#eee;font:16px/1.6 system-ui}}
main{{max-width:1320px;margin:auto;padding:32px 24px}}h1{{font-size:clamp(30px,5vw,58px);line-height:1.1}}
.eyebrow{{color:#00e5ff;font:13px monospace;letter-spacing:.15em}}a{{color:#00e5ff}}
.scope{{border-left:4px solid #ff8600;padding-left:18px}}pre{{background:#202020;padding:20px;overflow:auto}}
section{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}figure{{margin:0}}img{{width:100%;display:block;border:1px solid #555}}
figcaption{{font-weight:650;margin:10px 0}}footer{{margin-top:32px;color:#aaa}}@media(max-width:700px){{section{{grid-template-columns:1fr}}main{{padding:24px 16px}}}}
</style><main><p class="eyebrow">MANADJ / USB EXPORT / 2026-09-16</p>
<h1>Classic library, read by Rekordbox.</h1>
<p>74 tracks. 290 hot cues. Physical FAT32 stick, unmounted and remounted.</p>
<p>Rekordbox 7.2.14: playlist browsing, MP3/AAC playback, cue recall,
labels, colors, deck waveforms, browser previews and variable-tempo grids verified.</p>
<p class="scope">Not CDJ/XDJ hardware certification. Classic export is available through the CLI;
OneLibrary, incremental sync and an export UI are not included. Code is parked for review.</p>
<h2>Read-Back Checks</h2><p>94 focused tests passed. <a href="/source-check.json">Raw verification result</a></p>
<pre>{stats}</pre><h2>Rekordbox Evidence</h2><section>{images}</section>
<footer>Images open at full size. Only the listed evidence files are served.</footer></main></html>""".encode()
            kind = "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0)
    server = ThreadingHTTPServer(("127.0.0.1", parser.parse_args().port), Handler)
    print(f"http://localhost:{server.server_port}", flush=True)
    server.serve_forever()

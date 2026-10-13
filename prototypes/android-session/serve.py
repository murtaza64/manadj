"""Serve only the APK and brief notes; never expose the repo or toolchains."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=5192)
args = parser.parse_args()
apk = Path(__file__).parent / "app/build/outputs/apk/debug/app-debug.apk"
apk_bytes = apk.read_bytes()
digest = hashlib.sha256(apk_bytes).hexdigest()
notes = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>manadj Session · Android</title><style>body{{background:#000;color:#eee;font:16px system-ui;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.6}}a{{color:#00ccff}}code{{overflow-wrap:anywhere}}h1{{font-size:24px}}</style>
<h1>manadj / Session lab</h1><p><a href="/manadj-session.apk">Download Android APK</a> · Android 8+ · #368</p>
<p>Silent four-deck Session model. No audio engine; synthetic waveforms. Separate app from the performance prototype.</p>
<ol><li>PLAY advances the recorded Session on A–D. Pause or ±10 changes all views together.</li>
<li>Tap the timeline to seek. Drag to pan; pinch or ± to zoom; FIT restores the whole Session.</li>
<li>Scroll the tracklist; tap an occurrence to seek its first recorded sound.</li>
<li>IMPORT: select saved desktop GET /api/sessions/{{uuid}} JSON, then GET /api/tracks/ metadata pages from the same library. Unresolved IDs stay visible. Reload fixture is in the same menu.</li></ol>
<p>Unsupported scratch, active FX/tails, Take init, unknown events and versioned formats are refused. Backgrounding pauses; relaunch resets to fixture. No real-audio, physical-device or latency certification. Prototype only; not landed.</p>
<p><small>SHA256 <code>{digest}</code></small></p></html>""".encode()


class ReviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("/", "/review.html"):
            body, content_type = notes, "text/html; charset=utf-8"
        elif path == "/manadj-session.apk":
            body, content_type = apk_bytes, "application/vnd.android.package-archive"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(("0.0.0.0", args.port), ReviewHandler).serve_forever()

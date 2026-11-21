"""Loopback-only deterministic device-sync fixture. No user library or credentials."""
import signal
# Foundation Process may inherit a blocked signal mask on Linux. Allow clean termination.
signal.pthread_sigmask(signal.SIG_SETMASK, [])
import json
import sys
import time
from pathlib import Path
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SNAPSHOT = {"version": 1, "tag_categories": [], "tags": [], "tracks": [{"id":1,"file_name":"fixture.wav","audio_rev":"fixture-revision","filesize_bytes":1024}, {"id":2,"file_name":"missing.wav"}], "playlists": [], "settings": {}}
AUDIO = bytes(range(256)) * 4
class Handler(BaseHTTPRequestHandler):
    captures = 0
    def log_message(self, *args): pass
    def respond(self, code, body=b"", headers=None):
        self.send_response(code)
        self.send_header('Content-Length', str(len(body)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == '/stats':
            return self.respond(200,json.dumps({'captures':Handler.captures}).encode())
        if self.path == '/capture':
            Handler.captures += 1
            return self.respond(200,b'not audio')
        if self.path.startswith('/api/device-pair/request/'):
            return self.respond(200,json.dumps({'status':'approved','token':'fixture-not-a-real-token'}).encode())
        if self.headers.get('X-Manadj-Device-Token') != 'fixture-not-a-real-token':
            return self.respond(401)
        if self.path.endswith('/snapshot'):
            time.sleep(0.05)
            return self.respond(200,json.dumps(SNAPSHOT).encode())
        if self.path.endswith('/tracks/1/audio'):
            return self.respond(200,AUDIO,{'X-Audio-Rev':'fixture-revision'})
        if self.path.endswith('/tracks/2/audio'):
            return self.respond(302,headers={'Location':'/capture'})
        self.respond(404)
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
        if self.path=='/api/device-pair/request':
            if not body.get('device_id') or not body.get('device_name'): return self.respond(422)
            return self.respond(200,json.dumps({'id':'0123456789abcdef0123456789abcdef','match_code':'1234','expires_s':120}).encode())
        if self.path=='/api/device-sync/previews':
            return self.respond(200,b'MPK1'+struct.pack('<I',0))
        self.respond(404)

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(str(server.server_port))
else:
    print(server.server_port,flush=True)
server.serve_forever()

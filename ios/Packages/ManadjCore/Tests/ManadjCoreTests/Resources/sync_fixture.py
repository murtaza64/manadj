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

SNAPSHOT = {"version": 1, "tag_categories": [], "tags": [], "tracks": [{"id":1,"file_name":"fixture.wav","audio_rev":"fixture-revision","filesize_bytes":1024,"waveform_rev":"detail-revision","preview_rev":"preview-revision"}, {"id":2,"file_name":"missing.wav"}], "playlists": [], "settings": {}}
AUDIO = bytes(range(256)) * 4
def mwf(frames):
    return struct.pack('<4sHHIdIIIB3xf',b'MWF1',2,0,44100,24.,128,512,2048,8,.5)+struct.pack('<9f',20,60,150,400,1000,2500,6000,12000,20000)+struct.pack('<II',frames,frames)+bytes([128])*(frames*9)
DETAIL=mwf(2048)
PREVIEW=mwf(256)
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
        if self.path.endswith('/tracks/1/waveform'):
            return self.respond(200,DETAIL,{'X-Waveform-Rev':'detail-revision'})
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
            ids=body.get('track_ids',[])
            pack=b'MPK1'+struct.pack('<I',1 if 1 in ids else 0)
            if 1 in ids: pack+=struct.pack('<II',1,len(PREVIEW))+PREVIEW
            return self.respond(200,pack)
        self.respond(404)

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(str(server.server_port))
else:
    print(server.server_port,flush=True)
server.serve_forever()

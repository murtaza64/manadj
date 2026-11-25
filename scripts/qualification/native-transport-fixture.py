"""Loopback generated-only network fixture, not production auth or relay proof."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs

packets = {}
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def answer(self, value, status=200):
        raw=json.dumps(value,separators=(',',':')).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def route(self):
        parsed=urlsplit(self.path);parts=parsed.path.split('/')
        if self.headers.get('Authorization') != 'Bearer generated-loopback-only': self.answer({},403);return
        if len(parts)<7 or parts[1:3]!=['v1','sync'] or parts[4]!='origins': self.answer({},404);return
        key=(parts[3],parts[5]);rows=packets.setdefault(key,[])
        if parts[6]=='head': self.answer({'sequence':len(rows)});return
        if self.command=='PUT':
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));packet=body['packet'];seq=int(parts[7])
            if seq<=len(rows):
                if rows[seq-1]!=packet:self.answer({},409);return
            elif seq==len(rows)+1 and body['expectedPreviousSequence']==len(rows):rows.append(packet)
            else:self.answer({},409);return
            self.answer({'sequence':seq,'stored':True},201);return
        query=parse_qs(parsed.query);after=int(query['after'][0]);limit=int(query['limit'][0]);page=rows[after:after+limit]
        self.answer({'operations':page,'nextAfter':after+len(page),'more':after+len(page)<len(rows)})
    do_GET=route
    do_PUT=route
HTTPServer(('127.0.0.1',49371),Handler).serve_forever()

"""Durable SQLite relay reference for HTTP contract and crash/concurrency tests.

Not mounted in production. This has no owner-auth bypass: an embedding must
supply authenticated owner/device policy. Cloud hosting may use conditional
object heads only after proving equivalent commit/recovery semantics.
"""
import base64
import json
import sqlite3
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from .service import DOMAIN, MAX_PACKET_BYTES, MAX_PAGE_BYTES, SyncFailure, canonical, uuid


class Relay:
    def __init__(self, path):
        self.path = Path(path)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS membership (subject TEXT NOT NULL, group_id TEXT NOT NULL, origin_id TEXT NOT NULL, public_key TEXT NOT NULL, generation INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id, origin_id))')
            db.execute('CREATE TABLE IF NOT EXISTS operations (group_id TEXT, origin_id TEXT, seq INTEGER, payload BLOB NOT NULL, operation_id TEXT, PRIMARY KEY(group_id,origin_id,seq), UNIQUE(group_id,operation_id))')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA synchronous=FULL')
        return db

    def provision(self, subject, group, origin, public_key, generation=1):
        """Local owner bootstrap only. No HTTP enrollment or key replacement."""
        uuid(group); uuid(origin)
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key, validate=True))
        if not isinstance(subject, str) or not 1 <= len(subject) <= 256 or generation != 1:
            raise SyncFailure('invalid_local_provision')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT subject,public_key,generation,revoked FROM membership WHERE group_id=? AND origin_id=?', (group, origin)).fetchone()
            if old is not None:
                if old != (subject, public_key, generation, 0):
                    raise SyncFailure('enrollment_immutable_or_revoked')
                return
            db.execute('INSERT INTO membership VALUES(?,?,?,?,?,0)', (subject, group, origin, public_key, generation))

    def revoke(self, subject, group, origin):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE membership SET revoked=1 WHERE subject=? AND group_id=? AND origin_id=?', (subject, group, origin))

    def _verify(self, db, subject, group, origin, packet):
        row = db.execute('SELECT subject,public_key,generation,revoked FROM membership WHERE group_id=? AND origin_id=?', (group, origin)).fetchone()
        b = packet.get('body', {})
        if not row or row[0] != subject or row[3] or b.get('generation') != row[2]:
            raise SyncFailure('origin_enrollment_denied')
        try:
            Ed25519PublicKey.from_public_bytes(base64.b64decode(row[1], validate=True)).verify(
                base64.b64decode(packet['signature'], validate=True), DOMAIN + canonical(b))
        except Exception as error:
            raise SyncFailure('origin_signature_denied') from error

    def authorize_read(self, subject, group):
        with self.connect() as db:
            return db.execute('SELECT 1 FROM membership WHERE subject=? AND group_id=? AND revoked=0 LIMIT 1', (subject, group)).fetchone() is not None

    def head(self, group, origin):
        with self.connect() as db:
            return db.execute('SELECT COALESCE(MAX(seq),0) FROM operations WHERE group_id=? AND origin_id=?', (group, origin)).fetchone()[0]

    def publish(self, group, origin, seq, expected, packet, subject=None):
        raw = canonical(packet)
        if len(raw) > MAX_PACKET_BYTES or type(expected) is not int or type(seq) is not int or seq < 1 or expected != seq - 1:
            raise SyncFailure('invalid_append')
        b = packet.get('body', {})
        if (b.get('group_id'), b.get('origin_id'), b.get('sequence')) != (group, origin, seq):
            raise SyncFailure('wrong_operation_address')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if subject is not None:
                self._verify(db, subject, group, origin, packet)
            old = db.execute('SELECT payload FROM operations WHERE group_id=? AND origin_id=? AND seq=?', (group, origin, seq)).fetchone()
            if old:
                if old[0] != raw:
                    raise SyncFailure('immutable_append_conflict')
                return
            head = db.execute('SELECT COALESCE(MAX(seq),0) FROM operations WHERE group_id=? AND origin_id=?', (group, origin)).fetchone()[0]
            if head != expected:
                raise SyncFailure('head_compare_failed')
            duplicate = db.execute('SELECT origin_id,seq FROM operations WHERE group_id=? AND operation_id=?', (group, uuid(b['operation_id']))).fetchone()
            if duplicate:
                raise SyncFailure('operation_uuid_reused')
            db.execute('INSERT INTO operations VALUES(?,?,?,?,?)', (group, origin, seq, raw, b['operation_id']))

    def read(self, group, origin, after, limit):
        if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 32:
            raise SyncFailure('invalid_page')
        with self.connect() as db:
            rows = db.execute('SELECT seq,payload FROM operations WHERE group_id=? AND origin_id=? AND seq>? ORDER BY seq LIMIT ?', (group, origin, after, limit + 1)).fetchall()
            packets = []; next_after = after
            for seq, raw in rows[:limit]:
                if seq != next_after + 1:
                    raise SyncFailure('committed_log_gap')
                candidate = {'operations': packets + [json.loads(raw)], 'nextAfter': seq, 'more': True}
                if len(canonical(candidate)) > MAX_PAGE_BYTES:
                    if not packets:
                        raise SyncFailure('operation_exceeds_page_budget')
                    break
                packets.append(json.loads(raw)); next_after = seq
            return {'operations': packets, 'nextAfter': next_after, 'more': len(rows) > len(packets)}


def application(relay, authorize):
    app = FastAPI()

    async def check(request, group, origin, write=False):
        try:
            uuid(group); uuid(origin)
        except ValueError:
            raise HTTPException(404)
        # Caller policy binds authenticated owner AND pinned origin on writes.
        subject = await authorize(request)
        if not subject or not relay.authorize_read(subject, group):
            raise HTTPException(403)
        return subject

    @app.get('/v1/sync/{group}/origins/{origin}/head')
    async def head(group: str, origin: str, request: Request):
        await check(request, group, origin)
        return {'sequence': relay.head(group, origin)}

    @app.get('/v1/sync/{group}/origins/{origin}/operations')
    async def read(group: str, origin: str, request: Request, after: int = 0, limit: int = 8):
        await check(request, group, origin)
        try:
            return relay.read(group, origin, after, limit)
        except SyncFailure as error:
            raise HTTPException(422, str(error))

    @app.put('/v1/sync/{group}/origins/{origin}/operations/{seq}')
    async def publish(group: str, origin: str, seq: int, request: Request):
        subject = await check(request, group, origin, True)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_PACKET_BYTES:
                raise HTTPException(413)
        try:
            body = json.loads(raw)
            if not isinstance(body, dict) or set(body) != {'expectedPreviousSequence', 'packet'}:
                raise SyncFailure('invalid_append_envelope')
            packet = body['packet']
            expected = body['expectedPreviousSequence']
            if type(expected) is not int or not 0 <= expected < 9007199254740991:
                raise SyncFailure('invalid_expected_sequence')
            # Authentication is necessary but not sufficient. Server enrollment
            # verifies device signature and generation before append.
            relay.publish(group, origin, seq, expected, packet, subject=subject)
        except (ValueError, TypeError) as error:
            raise HTTPException(409, str(error))
        return JSONResponse({'sequence': seq, 'stored': True}, status_code=201)
    return app

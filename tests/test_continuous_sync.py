"""Actual independent SQLite libraries and Session rows, generated data only."""
import copy
import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from backend.continuous_sync.models import Cursor, Operation
from backend.continuous_sync.service import Replica, SyncFailure
from backend.models import Session as RecordedSession, SessionChunk, Track
from tests.test_device_group_mesh import setup
from tests.test_peer_session_exchange import instance as instance, seed, bind, post


def invoke(peer, gid, method, *args):
    with peer.sessions() as db:
        return getattr(Replica(db, gid), method)(*args)


def pair(instance):
    (a, b, _), gid, identities, seeds = setup(instance)
    logical = str(uuid4())
    for peer, local in ((a, 1), (b, 9)):
        seed(peer, local)
        bind(peer, local, logical)
    return a, b, gid, identities, logical


def track(peer, local):
    with peer.sessions() as db:
        row = db.get(Track, local)
        return row.title, row.cue_point_time, row.archived_at


def test_bidirectional_actual_metadata_active_chunks_restart_dedup_and_offline_origin(instance):
    a, b, gid, ids, logical = pair(instance)
    title = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'New on A')
    assert track(a, 1)[0] == 'New on A'
    assert invoke(b, gid, 'receive', title)['state'] == 'applied'
    cue = invoke(b, gid, 'issue', 'track:' + logical, 'main_cue', 12.5)
    # A is offline. B commits its own edit and a new active session locally.
    sid = str(uuid4())
    start = invoke(b, gid, 'issue', 'session:' + sid, 'start', '2026-11-25T16:00:00Z')
    chunk = invoke(b, gid, 'issue', 'session:' + sid, 'chunk:0', {
        'events': [{'t': 0, 'kind': 'load', 'channel': 'A', 'trackId': 9, 'bpm': 174},
                   {'t': .1, 'kind': 'transport', 'channel': 'A', 'action': 'play', 'playhead': 0}],
        'tracks': {'9': logical}})
    # Recreate backend engines; no retained in-memory outbox or cursors.
    a, b = instance('a'), instance('phone')
    packets = invoke(b, gid, 'packets', ids[1]['device_id'])
    assert packets == [cue, start, chunk]
    for packet in packets:
        assert invoke(a, gid, 'receive', packet)['state'] == 'applied'
        assert invoke(a, gid, 'receive', packet)['duplicate']
    assert track(a, 1)[:2] == track(b, 9)[:2] == ('New on A', 12.5)
    with a.sessions() as db:
        session = db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
        assert session.ended_at is None  # Active session, not closed-session backup.
        chunks = db.scalars(select(SessionChunk).where(SessionChunk.session_id == session.id)).all()
        assert len(chunks) == 1 and json.loads(chunks[0].events_json)[0]['trackId'] == 1
        assert db.get(Cursor, (gid, ids[1]['device_id'])).sequence == 3
    end = invoke(b, gid, 'issue', 'session:' + sid, 'end', '2026-11-25T16:01:00Z')
    invoke(a, gid, 'receive', end)
    with a.sessions() as db:
        assert db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid)).ended_at is not None


def test_concurrent_field_edits_preserved_and_explicit_resolution_converges(instance):
    a, b, gid, ids, logical = pair(instance)
    left = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'Left')
    right = invoke(b, gid, 'issue', 'track:' + logical, 'title', 'Right')
    assert invoke(a, gid, 'receive', right)['state'] == 'conflict'
    assert invoke(b, gid, 'receive', left)['state'] == 'conflict'
    for peer in (a, b):
        with peer.sessions() as db:
            rows = db.scalars(select(Operation).where(Operation.group_id == gid)).all()
            assert len(rows) == 2 and {json.loads(r.body)['value'] for r in rows} == {'Left', 'Right'}
    resolved = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'Chosen')
    assert set(resolved['body']['parents']) == {left['body']['operation_id'], right['body']['operation_id']}
    assert invoke(b, gid, 'receive', resolved)['state'] == 'applied'
    assert track(a, 1)[0] == track(b, 9)[0] == 'Chosen'


def test_tombstone_prevents_offline_resurrection(instance):
    a, b, gid, ids, logical = pair(instance)
    offline = invoke(b, gid, 'issue', 'track:' + logical, 'title', 'Offline')
    deleted = invoke(a, gid, 'issue', 'track:' + logical, 'deleted', True)
    invoke(b, gid, 'receive', deleted)
    assert invoke(a, gid, 'receive', offline)['state'] == 'blocked_by_tombstone'
    assert track(a, 1)[2] and track(b, 9)[2]


def test_untrusted_gap_mutation_and_rollback_do_not_advance_cursor(instance):
    a, b, gid, ids, logical = pair(instance)
    first = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'First')
    second = invoke(a, gid, 'issue', 'track:' + logical, 'main_cue', 1)
    with pytest.raises(SyncFailure, match='origin_gap'):
        invoke(b, gid, 'receive', second)
    tampered = copy.deepcopy(first); tampered['body']['value'] = 'Attacker'
    with pytest.raises(SyncFailure, match='invalid_signature'):
        invoke(b, gid, 'receive', tampered)
    assert track(b, 9)[0] == 'Generated'
    with b.sessions() as db:
        assert db.get(Cursor, (gid, ids[0]['device_id'])) is None
    invoke(b, gid, 'receive', first)
    invoke(b, gid, 'receive', second)


def test_automatic_capture_of_real_library_mutation_and_open_session_without_echo(instance):
    from datetime import datetime
    a, b, gid, ids, logical = pair(instance)
    invoke(a, gid, 'enroll_track', logical)
    invoke(b, gid, 'enroll_track', logical)
    sid = str(uuid4())
    with a.sessions() as db:
        row = db.get(Track, 1); row.title = 'Changed through normal ORM'
        session = RecordedSession(uuid=sid, started_at=datetime(2026, 11, 25, 16))
        db.add(session); db.flush()
        db.add(SessionChunk(session_id=session.id, seq=0, events_json=json.dumps([
            {'t': 0, 'kind': 'load', 'channel': 'A', 'trackId': 1, 'bpm': 174},
            {'t': .1, 'kind': 'transport', 'channel': 'A', 'action': 'play', 'playhead': 0}])))
        db.commit()
    packets = invoke(a, gid, 'capture')
    assert len(packets) == 3
    for packet in packets:
        invoke(b, gid, 'receive', packet)
    assert invoke(a, gid, 'capture') == invoke(b, gid, 'capture') == []
    assert track(b, 9)[0] == 'Changed through normal ORM'
    with a.sessions() as db:
        session = db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
        db.add(SessionChunk(session_id=session.id, seq=1, events_json=json.dumps([
            {'t': 5, 'kind': 'tick', 'playheads': {'A': 5}}])))
        session.ended_at = datetime(2026, 11, 25, 16, 1)
        db.commit()
    a = instance('a')
    packets = invoke(a, gid, 'capture')
    assert [p['body']['field'] for p in packets] == ['chunk:1', 'end']
    for packet in packets:
        invoke(b, gid, 'receive', packet)
    assert invoke(a, gid, 'capture') == invoke(b, gid, 'capture') == []
    with b.sessions() as db:
        session = db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
        assert session.ended_at is not None
        assert db.query(SessionChunk).filter_by(session_id=session.id).count() == 2


def test_bounded_automatic_pump_origin_offline_and_ambiguous_receipt_restart(instance):
    from backend.continuous_sync.pump import Pump
    a, b, gid, ids, logical = pair(instance)
    for peer in (a, b):
        invoke(peer, gid, 'enroll_track', logical)

    class Relay:
        def __init__(self):
            self.data = {}; self.lose_response = True
        def head(self, origin):
            return len(self.data.get(origin, []))
        def publish(self, packet, expected):
            stream = self.data.setdefault(packet['body']['origin_id'], [])
            assert expected == len(stream)
            stream.append(copy.deepcopy(packet))
            if self.lose_response:
                self.lose_response = False
                raise TimeoutError('response lost after commit')
        def read(self, origin, after, limit):
            return copy.deepcopy(self.data.get(origin, [])[after:after + limit])
    relay = Relay(); origins = [i['device_id'] for i in ids[:2]]
    pa = Pump(a.sessions, gid, relay, origins)
    with a.sessions() as db:
        db.get(Track, 1).title = 'Captured and sent automatically'; db.commit()
    with pytest.raises(TimeoutError):
        pa.tick()
    a = instance('a')
    assert Pump(a.sessions, gid, relay, origins).tick()['published'] == 0
    # A is now disconnected. B fetches committed changes from independent relay.
    pb = Pump(b.sessions, gid, relay, origins)
    assert pb.tick()['applied'] == 1
    assert track(b, 9)[0] == 'Captured and sent automatically'
    with b.sessions() as db:
        db.get(Track, 9).cue_point_time = 17; db.commit()
    pb.tick()
    Pump(a.sessions, gid, relay, origins).tick()
    assert track(a, 1)[1] == 17
    assert len(relay.data[origins[0]]) == len(relay.data[origins[1]]) == 1


def test_native_http_transport_real_durable_relay_restart_and_auth_denial(instance, tmp_path):
    from fastapi.testclient import TestClient
    from backend.continuous_sync.http import HTTPTransport
    from backend.continuous_sync.pump import Pump
    from backend.continuous_sync.relay import Relay, application
    a, b, gid, ids, logical = pair(instance)
    allowed = [i['device_id'] for i in ids[:2]]
    for peer in (a, b):
        invoke(peer, gid, 'enroll_track', logical)
    async def policy(request):
        return 'generated-owner-subject' if request.headers.get('authorization') == 'Bearer generated-test-owner' else None
    path = tmp_path / 'relay.db'
    relay = Relay(path)
    from backend.peer_sync.models import GroupMember
    with a.sessions() as db:
        for origin in allowed:
            relay.provision('generated-owner-subject', gid, origin, db.get(GroupMember, (gid, origin)).public_key_b64)
    client = TestClient(application(relay, policy), headers={'authorization': 'Bearer generated-test-owner'})
    transport = HTTPTransport(client, 'http://testserver', gid)
    with a.sessions() as db:
        db.get(Track, 1).title = 'Through actual HTTP'; db.commit()
    assert Pump(a.sessions, gid, transport, allowed).tick()['published'] == 1
    # Serving process recreated; A need not be online for B to receive.
    client.close()
    client = TestClient(application(Relay(path), policy), headers={'authorization': 'Bearer generated-test-owner'})
    transport = HTTPTransport(client, 'http://testserver', gid)
    assert Pump(b.sessions, gid, transport, allowed).tick()['applied'] == 1
    assert track(b, 9)[0] == 'Through actual HTTP'
    packet = invoke(a, gid, 'packets', allowed[0])[0]
    transport.publish(packet, 0)  # Exact retry remains idempotent.
    with TestClient(application(Relay(path), policy)) as stranger:
        with pytest.raises(SyncFailure, match='sync_http_403'):
            HTTPTransport(stranger, 'http://testserver', gid).head(allowed[0])
    assert transport.head(allowed[0]) == 1


def test_archive_capture_and_conflict_do_not_auto_resolve(instance):
    from datetime import datetime
    a, b, gid, ids, logical = pair(instance)
    for peer in (a, b):
        invoke(peer, gid, 'enroll_track', logical)
    left = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'Left')
    right = invoke(b, gid, 'issue', 'track:' + logical, 'title', 'Right')
    invoke(a, gid, 'receive', right); invoke(b, gid, 'receive', left)
    assert invoke(a, gid, 'capture') == invoke(b, gid, 'capture') == []
    with a.sessions() as db:
        db.get(Track, 1).archived_at = datetime(2026, 11, 25); db.commit()
    packets = invoke(a, gid, 'capture')
    assert len(packets) == 1 and packets[0]['body']['field'] == 'deleted'
    invoke(b, gid, 'receive', packets[0])
    assert track(b, 9)[2] is not None
    assert invoke(a, gid, 'capture') == invoke(b, gid, 'capture') == []


def test_http_same_owner_forged_origin_unpinned_revoked_and_uuid_reuse(instance, tmp_path):
    from fastapi.testclient import TestClient
    from backend.continuous_sync.http import HTTPTransport
    from backend.continuous_sync.relay import Relay, application
    from backend.peer_sync.models import GroupMember
    a, b, gid, ids, logical = pair(instance)
    relay = Relay(tmp_path / 'relay.db')
    origin = ids[0]['device_id']
    with a.sessions() as db:
        key = db.get(GroupMember, (gid, origin)).public_key_b64
    relay.provision('owner', gid, origin, key)
    async def owner(request):
        return 'owner'
    client = TestClient(application(relay, owner)); transport = HTTPTransport(client, 'http://testserver', gid)
    first = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'First')
    bad = copy.deepcopy(first); bad['body']['value'] = 'Forged with valid owner auth'
    with pytest.raises(SyncFailure, match='sync_http_409'):
        transport.publish(bad, 0)
    other = invoke(b, gid, 'issue', 'track:' + logical, 'title', 'Unpinned origin')
    with pytest.raises(SyncFailure, match='sync_http_409'):
        transport.publish(other, 0)
    assert transport.head(origin) == 0
    transport.publish(first, 0)
    relay.revoke('owner', gid, origin)
    second = invoke(a, gid, 'issue', 'track:' + logical, 'main_cue', 4)
    with pytest.raises(SyncFailure):
        transport.publish(second, 1)
    # Neither identical bootstrap nor another owner can un-revoke/replace key.
    with pytest.raises(SyncFailure, match='immutable_or_revoked'):
        relay.provision('owner', gid, origin, key)
    with pytest.raises(SyncFailure):
        relay.provision('someone-else', gid, origin, key)
    assert relay.head(gid, origin) == 1


def test_local_edit_between_capture_and_pull_is_not_overwritten(instance):
    a, b, gid, ids, logical = pair(instance)
    for peer in (a, b):
        invoke(peer, gid, 'enroll_track', logical)
    remote = invoke(a, gid, 'issue', 'track:' + logical, 'title', 'Remote')
    with b.sessions() as db:
        db.get(Track, 9).title = 'Just edited locally'; db.commit()
    assert invoke(b, gid, 'receive', remote)['state'] == 'conflict'
    assert track(b, 9)[0] == 'Just edited locally'
    local = invoke(b, gid, 'packets', ids[1]['device_id'])
    assert len(local) == 1 and local[0]['body']['value'] == 'Just edited locally'
    assert invoke(b, gid, 'capture') == []


def test_received_history_cannot_be_recovered_derived_or_laundered_as_local(instance):
    from fastapi import HTTPException
    from backend.session_source import deny_peer_write, deny_peer_derivation, session_events, preview_source
    from backend.routers.sessions import recover_open_sessions
    from backend.continuous_sync.models import SessionOwner
    from backend.peer_sync.service import PeerSync
    a, b, gid, ids, logical = pair(instance)
    sid = str(uuid4())
    start = invoke(a, gid, 'issue', 'session:' + sid, 'start', '2026-11-25T16:00:00Z')
    invoke(b, gid, 'receive', start)
    with b.sessions() as db:
        session = db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
        for attempt in (lambda: deny_peer_write(session), lambda: deny_peer_derivation(db, sid),
                        lambda: session_events(db, session), lambda: preview_source(db, sid)):
            with pytest.raises(HTTPException, match='409'):
                attempt()
        db.rollback()
        with pytest.raises(HTTPException):
            PeerSync(db).export(sid, None)
        db.rollback()
        assert recover_open_sessions(db) == {'closed': 0, 'deleted': 0}
        assert session.ended_at is None
        # Removing lossy denormalized provenance must not make it local.
        db.delete(db.get(SessionOwner, (gid, sid))); session.origin = None; db.commit()
        with pytest.raises(HTTPException):
            deny_peer_write(session)
    assert invoke(b, gid, 'capture') == []

import copy
import json
from datetime import datetime
from uuid import uuid4
import pytest
from sqlalchemy import select
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from backend.continuous_sync.service import DOMAIN, canonical, SyncFailure
from backend.continuous_sync.relay import Relay
from backend.continuous_sync.pump import Pump
from backend.models import Session as RecordedSession, SessionChunk
from tests.test_continuous_sync import pair, invoke, track
from tests.test_device_group_mesh import setup
from tests.test_peer_session_exchange import instance, seed, bind
import base64

class Transport:
    def __init__(self, relay, gid): self.relay, self.gid = relay, gid
    def head(self, origin): return self.relay.head(self.gid, origin)
    def publish(self, packet, expected):
        b=packet['body']; self.relay.publish(self.gid,b['origin_id'],b['sequence'],expected,packet)
    def read(self, origin, after, limit): return self.relay.read(self.gid,origin,after,limit)['operations']

def test_review_causal_origin_order_stalls(instance,tmp_path):
    (a,b,c),gid,ids,seeds=setup(instance)
    logical=str(uuid4())
    for peer,local in ((a,1),(b,9),(c,20)):
        seed(peer,local); bind(peer,local,logical)
    parent=invoke(a,gid,'issue','track:'+logical,'title','Parent')
    invoke(b,gid,'receive',parent)
    child=invoke(b,gid,'issue','track:'+logical,'title','Child')
    t=Transport(Relay(tmp_path/'relay.db'),gid)
    t.publish(parent,0);t.publish(child,0)
    pump=Pump(c.sessions,gid,t,[ids[1]['device_id'],ids[0]['device_id']])
    assert pump.tick()['applied'] == 1
    assert pump.tick()['applied'] == 1
    assert track(c,20)[0]=='Child'

def test_review_remote_fork_head_silently_skips_upload(instance,tmp_path):
    a,b,gid,ids,logical=pair(instance)
    local=invoke(a,gid,'issue','track:'+logical,'title','Local')
    fork=copy.deepcopy(local);fork['body']['value']='Different signed history'
    fork['signature']=base64.b64encode(Ed25519PrivateKey.from_private_bytes(bytes([1])*32).sign(DOMAIN+canonical(fork['body']))).decode()
    t=Transport(Relay(tmp_path/'relay.db'),gid);t.publish(fork,0)
    with pytest.raises(SyncFailure, match='remote_local_history_fork'):
        Pump(a.sessions,gid,t,[ids[0]['device_id']]).tick()
    assert t.read(ids[0]['device_id'],0,8)==[fork]
    assert invoke(a,gid,'packets',ids[0]['device_id'])==[local]

def test_review_normal_session_gap_capture_cannot_deliver(instance):
    a,b,gid,ids,logical=pair(instance)
    sid=str(uuid4())
    with a.sessions() as db:
        s=RecordedSession(uuid=sid,started_at=datetime(2026,11,25,16));db.add(s);db.flush()
        db.add(SessionChunk(session_id=s.id,seq=2,events_json=json.dumps([{'t':0,'kind':'tick','playheads':{'A':0}}])))
        db.commit()
    packets=invoke(a,gid,'capture')
    assert [p['body']['field'] for p in packets]==['start','chunk:2']
    invoke(b,gid,'receive',packets[0])
    assert invoke(b,gid,'receive',packets[1])['state'] == 'applied'
    with b.sessions() as db:
        session = db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
        assert [chunk.seq for chunk in session.chunks] == [2]


def test_verified_remote_prefix_advances_with_one_packet_budget_and_detects_rollback(instance, tmp_path):
    a, b, gid, ids, logical = pair(instance)
    transport = Transport(Relay(tmp_path / 'relay.db'), gid)
    packets = [invoke(a, gid, 'issue', 'track:' + logical, 'title', str(n)) for n in range(4)]
    for packet in packets:
        transport.publish(packet, packet['body']['sequence'] - 1)
    pump = Pump(a.sessions, gid, transport, [ids[0]['device_id']])
    from backend.continuous_sync.models import RelayCheckpoint
    for sequence in range(1, 5):
        assert pump.tick(limit=1) == {'published': 0, 'applied': 0}
        with a.sessions() as db:
            assert db.get(RelayCheckpoint, (gid, ids[0]['device_id'])).sequence == sequence
    with transport.relay.connect() as db:
        db.execute('DELETE FROM operations WHERE seq=4')
    with pytest.raises(SyncFailure, match='remote_head_rollback'):
        pump.tick(limit=1)

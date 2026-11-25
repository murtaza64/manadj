"""Apply actual generated Apple signed history through HTTP relay to real ORM.

No personal database, paths, credentials, network service or deployment. Uses
independently generated receiver key and deliberately different local track ID.
"""
import base64
import json
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.continuous_sync.http import HTTPTransport
from backend.continuous_sync.models import Cursor
from backend.continuous_sync.relay import Relay, application
from backend.continuous_sync.service import Replica
from backend.models import Session, SessionChunk, Track
from backend.peer_sync.models import DeviceGroup, GroupMember, SyncTrack

value = json.loads(Path(sys.argv[1]).read_bytes())
with tempfile.TemporaryDirectory(prefix='generated-native-history-') as directory:
    root = Path(directory)
    engine = create_engine('sqlite:///' + str(root / 'receiver.db'))
    with engine.connect() as connection:
        config = Config('alembic.ini')
        config.attributes.update(connection=connection, configure_logger=False)
        command.upgrade(config, 'head')
    sessions = sessionmaker(bind=engine, autoflush=False)
    own = str(uuid4()); key = Ed25519PrivateKey.generate()
    own_public = base64.b64encode(key.public_key().public_bytes_raw()).decode()
    with sessions() as db:
        db.add(Track(id=99, filename=str(root / 'generated-only.wav'), title='Receiver generated', artist='Synthetic'))
        db.add(DeviceGroup(group_id=value['group'], device_id=own, private_seed_b64=base64.b64encode(key.private_bytes_raw()).decode()))
        db.flush()
        for origin, public in [(own, own_public), (value['origin'], value['publicKey'])]:
            db.add(GroupMember(group_id=value['group'], device_id=origin, public_key_b64=public, revoked=0))
        db.add(SyncTrack(logical_track_id=value['logical'], track_id=99)); db.commit()
    relay = Relay(root / 'relay.db')
    relay.provision('generated-owner', value['group'], value['origin'], value['publicKey'])
    async def policy(request):
        return 'generated-owner' if request.headers.get('authorization') == 'Bearer generated-fixture-only' else None
    with TestClient(application(relay, policy), headers={'authorization': 'Bearer generated-fixture-only'}) as http:
        transport = HTTPTransport(http, 'http://testserver', value['group'])
        for packet in value['packets']:
            transport.publish(packet, packet['body']['sequence'] - 1)
        after = 0
        while after < len(value['packets']):
            packets = transport.read(value['origin'], after, 4)
            assert packets
            for packet in packets:
                with sessions() as db:
                    Replica(db, value['group']).receive(packet)
                with sessions() as db:
                    assert Replica(db, value['group']).receive(packet)['duplicate']
                after += 1
    with sessions() as db:
        recorded = list(db.scalars(select(Session)))
        assert len(recorded) == 1 and recorded[0].ended_at is not None
        chunks = list(db.scalars(select(SessionChunk).order_by(SessionChunk.seq)))
        assert len(chunks) == 3
        events = [event for chunk in chunks for event in json.loads(chunk.events_json)]
        assert len(events) == 62 and events[0]['trackId'] == 99
        assert events[-1]['t'] == 61
        assert db.get(Cursor, (value['group'], value['origin'])).sequence == 5
    engine.dispose()
print('ACTUAL_APPLE_HISTORY_PACKETS_HTTP_RELAY_TO_INDEPENDENT_BACKEND_SQLITE_PASS')

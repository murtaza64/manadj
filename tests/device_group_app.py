"""Generated-only HTTP integration fixture for Python↔Kotlin group relay.

Run: uv run uvicorn tests.device_group_app:create_app --factory --host 127.0.0.1 --port PORT
Data: .tmp/device-group-452 (or MANADJ_GROUP_FIXTURE_ROOT). Public decoy keys,
never actual pairing/Library credentials. Restart retains all fixture ledgers.
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from alembic import command
from backend.database import apply_sqlite_pragmas, get_db
from backend.peer_sync.group import GroupSync
from backend.peer_sync.group_router import router as group_router
from backend.peer_sync.models import DeviceGroup, GroupAck, GroupOperation, SyncLocal
from backend.peer_sync.router import router as peer_router
from tests.test_peer_session_exchange import export, seed

GROUP = "33333333-3333-4333-8333-333333333333"
DEVICES = {"a": "11111111-1111-4111-8111-111111111111",
           "phone": "22222222-2222-4222-8222-222222222222",
           "b": "88888888-8888-4888-8888-888888888888"}
SEEDS = {name: bytes(range(offset, offset + 32)) for name, offset in [("a", 0), ("phone", 32), ("b", 64)]}
SESSIONS = {"a": "55555555-5555-4555-8555-555555555555", "b": "99999999-9999-4999-8999-999999999999"}


def database_dependency(factory):
    def database():
        with factory() as db:
            yield db
    return database


def create_app():
    root = Path(os.environ.get("MANADJ_GROUP_FIXTURE_ROOT", ".tmp/device-group-452"))
    root.mkdir(parents=True, exist_ok=True)
    replicas, identities, provisioned = {}, {}, set()

    @asynccontextmanager
    async def lifespan(app):
        yield
        for peer in replicas.values():
            peer.engine.dispose()

    app = FastAPI(title="Generated device-group relay fixture", lifespan=lifespan)
    for name, device in DEVICES.items():
        local_root = root / name
        local_root.mkdir(exist_ok=True)
        engine = create_engine(f"sqlite:///{local_root / 'library.db'}", connect_args={"check_same_thread": False})
        event.listen(engine, "connect", apply_sqlite_pragmas)
        with engine.connect() as connection:
            cfg = Config(str(Path(__file__).parents[1] / "alembic.ini"))
            cfg.attributes.update(connection=connection, configure_logger=False)
            command.upgrade(cfg, "head")
        sessions = sessionmaker(bind=engine, autoflush=False)
        child = FastAPI(title=f"Generated replica {name}")
        child.include_router(group_router, prefix="/api/device-groups")
        child.include_router(peer_router, prefix="/api/peer-sync")

        child.dependency_overrides[get_db] = database_dependency(sessions)
        peer = SimpleNamespace(root=local_root, engine=engine, sessions=sessions, client=TestClient(child))
        replicas[name] = peer
        with sessions() as db:
            if db.get(SyncLocal, 1) is None:
                db.add(SyncLocal(id=1, replica_id=device))
                db.commit()
            group = db.get(DeviceGroup, GROUP)
            needs_provision = group is None
        if needs_provision:
            provisioned.add(name)
            with sessions() as db:
                identities[name] = GroupSync(db, GROUP).provision(SEEDS[name])
        else:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

            from backend.peer_sync.group_contracts import encode
            identities[name] = {"device_id": device, "public_key_b64": encode(
                Ed25519PrivateKey.from_private_bytes(SEEDS[name]).public_key().public_bytes_raw())}
        app.mount(f"/{name}", child)
    for name, peer in replicas.items():
        for identity in identities.values() if name in provisioned else []:
            with peer.sessions() as db:
                GroupSync(db, GROUP).pin_member(identity["device_id"], identity["public_key_b64"])
        if name in SESSIONS:
            with peer.sessions() as db:
                issued = db.query(GroupOperation).filter_by(group_id=GROUP, session_uuid=SESSIONS[name]).first() is not None
            if not issued:
                seed(peer, 1, session_uuid=SESSIONS[name])
                export(peer, SESSIONS[name])
                with peer.sessions() as db:
                    GroupSync(db, GROUP).issue(SESSIONS[name])

    @app.get("/")
    def fixture():
        return {"generated_only": True, "group_id": GROUP, "members": identities,
                "PUBLIC_TEST_SEEDS_HEX": {name: seed.hex() for name, seed in SEEDS.items()},
                "sessions": SESSIONS, "status": "/status",
                "apis": {name: f"/{name}/docs" for name in DEVICES},
                "note": "Native phone uses PUBLIC phone seed/member identity; no real devices or credentials."}

    @app.get("/status")
    def status():
        result = {}
        for name, peer in replicas.items():
            with peer.sessions() as db:
                result[name] = {"operations": [{"operation_id": row.operation_id, "session_uuid": row.session_uuid,
                    "origin_device_id": row.origin_device_id, "sha256": row.sha256}
                    for row in db.query(GroupOperation).order_by(GroupOperation.cursor)], "acks": db.query(GroupAck).count()}
        return result

    return app

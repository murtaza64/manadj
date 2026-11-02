"""NEW generated-only #456 HTTP fixture. No host DB/config or real credentials.

Run with uvicorn tests.group_replay_app:create_app --factory. Set
MANADJ_REPLAY_FIXTURE_ROOT to a new sandbox; restarts retain selections/ledgers.
"""
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from alembic import command
from backend.database import apply_sqlite_pragmas, get_db
from backend.models import Track
from backend.peer_sync.group_contracts import Signed, encode
from backend.peer_sync.group_router import router as group_router
from backend.peer_sync.models import DeviceGroup, GroupOperation, SyncLocal
from backend.peer_sync.router import router as peer_router
from backend.routers.sessions import router as history_router
from scripts.group_replay_fixture import fixture, wav_bytes
from tests.device_group_app import database_dependency
from tests.peer_folder_app import fixture_app
from tests.test_device_group_mesh import call, push

GROUP = "77777777-7777-4777-8777-777777777777"
DEVICES = {"a": "11111111-1111-4111-8111-111111111111", "phone": "22222222-2222-4222-8222-222222222222",
           "b": "88888888-8888-4888-8888-888888888888"}
SEEDS = {name: bytes(range(offset, offset + 32)) for name, offset in [("a", 0), ("phone", 32), ("b", 64)]}


def create_app():
    root = Path(os.environ.get("MANADJ_REPLAY_FIXTURE_ROOT", ".tmp/group456-http"))
    root.mkdir(parents=True, exist_ok=True)
    value = fixture()
    body = json.loads(value["body_utf8"])
    oid, sid = body["operation_id"], body["bundle"]["manifest"]["session_uuid"]
    replicas = {}

    @asynccontextmanager
    async def lifespan(app):
        yield
        for peer in replicas.values():
            peer.engine.dispose()

    app = FastAPI(title="Generated #456 exact-local replay", lifespan=lifespan)
    app.state.replicas = replicas
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
        child = FastAPI()
        child.include_router(group_router, prefix="/api/device-groups")
        child.include_router(peer_router, prefix="/api/peer-sync")
        child.include_router(history_router, prefix="/api/sessions")
        child.dependency_overrides[get_db] = database_dependency(sessions)
        peer = SimpleNamespace(root=local_root, engine=engine, sessions=sessions, client=TestClient(child))
        replicas[name] = peer
        with sessions() as db:
            if db.get(SyncLocal, 1) is None:
                db.add(SyncLocal(id=1, replica_id=device))
                db.commit()
            needs_provision = db.get(DeviceGroup, GROUP) is None
        if needs_provision:
            call(peer, GROUP, "provision", SEEDS[name])
            for member, identity in DEVICES.items():
                key = Ed25519PrivateKey.from_private_bytes(SEEDS[member]).public_key().public_bytes_raw()
                call(peer, GROUP, "pin_member", identity, encode(key), f"Synthetic {member}")
        for local, asset in zip((7, 9) if name == "a" else (73, 88) if name == "b" else (509, 510), value["assets"]):
            with sessions() as db:
                if db.get(Track, local) is None:
                    path = local_root / asset["file_name"]
                    if path.exists():
                        raise ValueError("Never overwrite a preexisting generated asset")
                    recipe = asset["recipe"]
                    path.write_bytes(wav_bytes(recipe["period_frames"], recipe["amplitude"]))
                    db.add(Track(id=local, filename=str(path), title=asset["file_name"], bpm=12000, duration_secs=2,
                                 filesize_bytes=asset["asset"]["byte_length"]))
                    db.commit()
        app.mount(f"/{name}", child)
    # Seed the literal signed source as test evidence only. Both receiver hops
    # use the production signed delivery/ack HTTP adapters, never audio transfer.
    a, phone, b = [replicas[name] for name in ("a", "phone", "b")]
    signed = Signed(body_b64=encode(value["body_utf8"].encode()), signature_b64=value["signature_b64"])
    with a.sessions() as db:
        if db.query(GroupOperation).filter_by(group_id=GROUP, operation_id=oid).first() is None:
            db.add(GroupOperation(group_id=GROUP, operation_id=oid, session_uuid=sid, origin_device_id=DEVICES["a"],
                sha256=value["operation_sha256"], body_b64=signed.body_b64, signature_b64=signed.signature_b64))
            db.commit()
    if os.environ.get("MANADJ_REPLAY_SEED_RELAY") == "1":
        push(a, phone, GROUP, DEVICES["phone"], signed)
        push(phone, b, GROUP, DEVICES["b"], signed)

    @app.get("/fixture.json")
    def fixture_json():
        return {**value, "generated_only": True, "devices": DEVICES,
                "PUBLIC_TEST_SEEDS_HEX": {name: seed.hex() for name, seed in SEEDS.items()},
                "replay": f"/api/peer-sync/group-replay/{GROUP}/{oid}", "source_issued_from_literal_test_evidence": True}

    @app.get("/history")
    def history_page():
        from fastapi.responses import FileResponse
        return FileResponse(Path(__file__).parents[1] / "frontend/dist/index.html")

    app.mount("/", fixture_app(b))
    return app

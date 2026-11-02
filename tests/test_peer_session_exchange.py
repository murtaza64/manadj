"""Actual durable Session event exchange, independent migrated DBs and decoy assets."""
import copy
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.database import apply_sqlite_pragmas, get_db
from backend.models import Session as RecordedSession
from backend.models import SessionChunk, Take, Track, TrackLink, Transition


@pytest.fixture
def instance(tmp_path):
    from backend.peer_sync.router import router
    engines = []

    def make(name):
        root = tmp_path / name
        root.mkdir(exist_ok=True)
        engine = create_engine(f"sqlite:///{root / 'library.db'}", connect_args={"check_same_thread": False})
        event.listen(engine, "connect", apply_sqlite_pragmas)
        engines.append(engine)
        with engine.connect() as connection:
            cfg = Config(str(Path(__file__).parents[1] / "alembic.ini"))
            cfg.attributes.update(connection=connection, configure_logger=False)
            command.upgrade(cfg, "head")
        sessions = sessionmaker(bind=engine, autoflush=False)
        app = FastAPI()
        app.include_router(router, prefix="/api/peer-sync")

        def database():
            with sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        return SimpleNamespace(root=root, engine=engine, sessions=sessions, client=TestClient(app))

    yield make
    for engine in engines:
        engine.dispose()


def post(peer, path, body=None, status=200):
    response = peer.client.post("/api/peer-sync/" + path, json=body or {})
    assert response.status_code == status, response.text
    return response.json()


def get(peer, path, status=200):
    response = peer.client.get("/api/peer-sync/" + path)
    assert response.status_code == status, response.text
    return response.json()


def seed(peer, track_id, *, session_uuid=None, filename="generated.wav"):
    path = peer.root / filename
    path.write_bytes(b"generated-decoy-selected-audio" * 20)
    with peer.sessions() as db:
        db.add(Track(id=track_id, filename=str(path), title="Generated", artist="Synthetic",
                     filesize_bytes=path.stat().st_size, duration_secs=24, bpm=17400))
        if session_uuid:
            recorded = RecordedSession(uuid=session_uuid, started_at=datetime(2026, 1, 1),
                                       ended_at=datetime(2026, 1, 1, 0, 1))
            db.add(recorded)
            db.flush()
            for seq, events in enumerate([
                [{"t": 0, "kind": "load", "channel": "A", "trackId": track_id, "bpm": 174},
                 {"t": 0.1, "kind": "transport", "channel": "A", "action": "play", "playhead": 0},
                 {"t": 0.2, "kind": "beatFx", "selected": "echo", "target": "A", "on": False,
                  "depth": 0, "beats": 1, "held": ["B"]},
                 {"t": 0.3, "kind": "beatFxSettings", "settings": {"echoFeedback": 0.5, "flangerLengthUnit": "bars"}}],
                [{"t": 10.0, "kind": "tick", "playheads": {"A": 10.0}}],
            ]):
                db.add(SessionChunk(session_id=recorded.id, seq=seq, events_json=json.dumps(events)))
        db.commit()
    if session_uuid:
        guard = post(peer, f"tracks/{track_id}/select")["guard"]
        post(peer, f"tracks/{track_id}/identify", {"guard": guard})
    return path


def setup_pair(instance):
    a, b = instance("a"), instance("b")
    ai, bi = post(a, "identity"), post(b, "identity")
    post(b, "sources", {"replica_id": ai["replica_id"], "label": "Selected own desktop"})
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    seed(b, 9)
    seed(b, 1, filename="unrelated.wav")  # real local collision, not the received Track
    return a, b, ai, bi, sid


def export(peer, sid, **kwargs):
    return post(peer, f"sessions/{sid}/export", {"reference_basis": "explicit-current-row-bindings", "fingerprint_assets": True, **kwargs})


def bind(peer, local_id, logical_id):
    guard = post(peer, f"tracks/{local_id}/select")["guard"]
    return post(peer, f"tracks/{local_id}/bind", {"guard": guard, "logical_track_id": logical_id})


def no_personal(peer):
    with peer.sessions() as db:
        assert db.query(RecordedSession).count() == db.query(Take).count() == 0
        assert db.query(Transition).count() == db.query(TrackLink).count() == 0


def test_durable_real_exchange_partial_resolution_restart_retry_and_no_personal_materialization(instance):
    from backend.routers.device_sync import build_snapshot
    from backend.schemas import SessionDetail
    a, b, ai, bi, sid = setup_pair(instance)
    with b.sessions() as db:
        phone_before = build_snapshot(db)
    packet = export(a, sid, seqs=[0])
    assert str(a.root) not in json.dumps(packet) and "filename" not in json.dumps(packet)
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    assert logical != packet["manifest"]["tracks"][0]["asset"]["sha256"]
    assert post(b, "imports", packet)["duplicate"] is False
    assert get(b, f"sessions/{sid}")["state"] == "partial_chunks"
    b = instance("b")  # offline partial receipt survives a new engine/app
    assert get(b, f"sessions/{sid}")["stored_seqs"] == [0]
    post(b, "imports", export(a, sid, seqs=[1]))
    assert get(b, f"sessions/{sid}")["state"] == "unresolved_references"
    no_personal(b)
    bind(b, 9, logical)
    detail = get(b, f"sessions/{sid}")
    assert detail["state"] == "resolved" and detail["dependencies_ready"] is True
    assert detail["session"]["events"][0]["trackId"] == 9  # NEVER colliding receiver1
    assert detail["session"]["events"][2]["selected"] == "echo"
    assert detail["session"]["events"][2]["held"] == ["B"]
    assert detail["session"]["uuid"] == sid and detail["capabilities"]["library_apply"] is False
    assert SessionDetail.model_validate(detail["session"]).uuid == sid  # existing phone/desktop read shape
    with b.sessions() as db:
        phone_after = build_snapshot(db)
    phone_before.pop("generated_at")
    phone_after.pop("generated_at")
    assert phone_before == phone_after  # local integers, fields and journal/snapshot protocol preserved
    restarted = instance("b")
    assert get(restarted, "identity") == bi
    assert get(restarted, f"sessions/{sid}") == detail
    assert post(restarted, "imports", packet)["duplicate"] is True
    assert export(a, sid)["manifest"] == packet["manifest"]
    assert get(instance("a"), "identity") == ai
    probe = subprocess.run([sys.executable, "-c", """
import json, os, sys
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend.peer_sync.service import PeerSync
with Session(create_engine(sys.argv[1])) as db:
    service = PeerSync(db)
    print(json.dumps({'pid': os.getpid(), 'identity': service.identity(), 'detail': service.detail(sys.argv[2])}))
""", str(restarted.engine.url), sid], check=True, capture_output=True, text=True)
    fresh = json.loads(probe.stdout)
    assert fresh["pid"] != os.getpid() and fresh["identity"] == bi and fresh["detail"] == detail
    no_personal(restarted)


def test_partial_missing_changed_assets_and_deleted_reused_local_ids_never_guess(instance):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    post(b, "imports", packet)
    bind(b, 9, logical)
    path = b.root / "generated.wav"
    original = path.read_bytes()
    path.write_bytes(original[:5])
    assert get(b, f"sessions/{sid}")["dependencies"][0]["asset_state"] == "partial"
    path.unlink()
    assert get(b, f"sessions/{sid}")["dependencies"][0]["asset_state"] == "missing"
    path.write_bytes(original)
    assert get(b, f"sessions/{sid}")["dependencies"][0]["asset_state"] == "exact"
    previous_stat = path.stat()
    path.write_bytes(b"x" * len(original))
    os.utime(path, ns=(previous_stat.st_atime_ns, previous_stat.st_mtime_ns))
    assert get(b, f"sessions/{sid}")["dependencies"][0]["asset_state"] == "changed"
    path.write_bytes(original)
    with b.sessions() as db:
        db.delete(db.get(Track, 9))
        db.commit()
    seed(b, 9, filename="reused.wav")
    assert get(b, f"sessions/{sid}")["state"] == "unresolved_references"
    seed(b, 10, filename="deliberate-rebinding.wav")
    bind(b, 10, logical)
    assert get(b, f"sessions/{sid}")["session"]["events"][0]["trackId"] == 10


def test_hash_missing_is_unverified_not_identity_and_namespace_must_be_explicit(instance):
    a, b, ai, _, sid = setup_pair(instance)
    packet = export(a, sid, fingerprint_assets=False)
    assert packet["manifest"]["tracks"][0]["asset"] is None
    stranger = instance("stranger")
    post(stranger, "identity")
    post(stranger, "imports", packet, status=403)
    post(b, "imports", packet)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    detail = get(b, f"sessions/{sid}")
    assert detail["dependencies_ready"] is False
    assert detail["dependencies"][0]["asset_state"] == "unverified"
    assert detail["origin_replica_id"] == ai["replica_id"]


def test_conflicting_uuid_content_is_durable_conflict_not_overwrite_and_distinct_sessions_union(instance):
    from backend.peer_sync.contracts import digest
    from backend.peer_sync.models import SyncConflict
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    post(b, "imports", packet)
    bad = copy.deepcopy(packet)
    bad["manifest"]["ended_at"] = "2026-01-01T00:02:00Z"
    post(b, "imports", bad, status=409)
    post(b, "imports", bad, status=409)
    with b.sessions() as db:
        assert db.query(SyncConflict).count() == 1
    changed = copy.deepcopy(packet)
    changed["chunks"][0]["events"][1]["playhead"] = 5
    changed["manifest"]["chunk_sha256"][0] = digest(changed["chunks"][0]["events"])
    post(b, "imports", changed, status=409)
    with b.sessions() as db:
        assert db.query(SyncConflict).count() == 2  # both variants retained, original unchanged
    assert len(get(instance("b"), f"sessions/{sid}/conflicts")["items"]) == 2
    assert get(b, f"sessions/{sid}")["manifest_sha256"] == get(instance("b"), f"sessions/{sid}")["manifest_sha256"]
    assert post(b, "imports", packet)["duplicate"] is True
    second = str(uuid4())
    seed(a, 2, session_uuid=second, filename="second.wav")
    second_packet = export(a, second)
    assert second_packet["manifest"]["tracks"][0]["asset"] == packet["manifest"]["tracks"][0]["asset"]
    assert second_packet["manifest"]["tracks"][0]["logical_track_id"] != packet["manifest"]["tracks"][0]["logical_track_id"]
    post(b, "imports", second_packet)
    assert len(get(b, "sessions")["items"]) == 2
    no_personal(b)


def test_source_outbox_freezes_selected_manifest_and_events_without_refreshing_asset_version(instance):
    a, _, _, _, sid = setup_pair(instance)
    original = export(a, sid)
    (a.root / "generated.wav").write_bytes(b"changed after explicit export")
    with a.sessions() as db:
        recorded = db.query(RecordedSession).filter_by(uuid=sid).one()
        recorded.chunks[0].events_json = "[]"
        db.commit()
    assert export(instance("a"), sid) == original


def test_deleted_same_path_id_and_timestamp_cannot_reuse_a_stale_selection_guard(instance):
    a, b, _, _, sid = setup_pair(instance)
    logical = export(a, sid)["manifest"]["tracks"][0]["logical_track_id"]
    old = post(b, "tracks/9/select")["guard"]
    bind(b, 9, logical)
    with b.sessions() as db:
        timestamp = db.get(Track, 9).created_at
        db.delete(db.get(Track, 9))
        db.commit()
    seed(b, 9)  # exact same local ID/path/created-at; new row incarnation
    with b.sessions() as db:
        db.get(Track, 9).created_at = timestamp
        db.commit()
    assert get(b, "tracks/9")["guard"] is None
    post(b, "tracks/9/bind", {"guard": old, "logical_track_id": logical}, status=409)
    new = post(b, "tracks/9/select")["guard"]
    assert new != old
    post(b, "tracks/9/bind", {"guard": old, "logical_track_id": logical}, status=409)


def test_silent_source_invalid_timestamps_and_local_phone_isolation(instance):
    from backend.device_listener import PAIR_HEADER, build_app
    from backend.peer_sync.models import SyncSession
    a, b, _, _, sid = setup_pair(instance)
    remote_client = TestClient(b.client.app, client=("192.0.2.9", 9000))
    assert remote_client.post("/api/peer-sync/identity", json={}).status_code == 403
    assert b.client.post("/api/peer-sync/identity", json={}, headers={"Origin": "https://elsewhere.invalid"}).status_code == 403
    phone = TestClient(build_app(lambda: "ABCDE-FGHJK"))
    assert phone.post("/api/peer-sync/identity", json={}, headers={PAIR_HEADER: "ABCDE-FGHJK"}).status_code == 404
    packet = export(a, sid)
    bad = copy.deepcopy(packet)
    bad["manifest"]["started_at"] = 12345
    post(b, "imports", bad, status=422)
    silent = str(uuid4())
    seed(a, 2, session_uuid=silent, filename="silent.wav")
    with a.sessions() as db:
        recorded = db.query(RecordedSession).filter_by(uuid=silent).one()
        events = json.loads(recorded.chunks[0].events_json)
        events[1]["action"] = "pause"
        events[2]["held"] = []
        recorded.chunks[0].events_json = json.dumps(events)
        db.commit()
    post(a, f"sessions/{silent}/export", {"reference_basis": "explicit-current-row-bindings", "fingerprint_assets": False}, status=422)
    with a.sessions() as db:
        assert db.get(SyncSession, silent) is None


def test_portable_chunk_hashes_survive_json_number_normalization_and_explicit_algorithm_is_required(instance):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)

    def javascript_numbers(value):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {key: javascript_numbers(item) for key, item in value.items()}
        if isinstance(value, list):
            return [javascript_numbers(item) for item in value]
        return value

    normalized = javascript_numbers(packet)
    assert post(b, "imports", normalized)["state"] == "stored_complete"
    assert post(b, "imports", packet)["duplicate"] is True
    del normalized["digest_algorithm"]
    post(b, "imports", normalized, status=422)


def test_local_history_uuid_collision_preserves_actual_both_sides_not_a_fake_manifest_digest(instance):
    from backend.peer_sync.contracts import digest
    from backend.peer_sync.models import SyncConflict
    a, b, _, _, sid = setup_pair(instance)
    seed(b, 12, session_uuid=sid, filename="different-local-history.wav")
    packet = export(a, sid)
    post(b, "imports", packet, status=409)
    with b.sessions() as db:
        conflict = db.query(SyncConflict).one()
        original = json.loads(conflict.existing_json)
        assert conflict.existing_kind == "local_history_snapshot"
        assert conflict.existing_sha256 == digest(original)
        assert original["chunks"][0]["events"][0]["trackId"] == 12
        assert json.loads(conflict.incoming_json)["chunks"][0]["events"][0]["trackId"] == 1
        assert db.query(RecordedSession).count() == 1
    assert get(b, "sessions")["items"] == []


def test_stored_event_corruption_never_projects_as_verified_evidence(instance):
    from backend.peer_sync.models import SyncChunk
    a, b, _, _, sid = setup_pair(instance)
    post(b, "imports", export(a, sid))
    with b.sessions() as db:
        chunk = db.get(SyncChunk, (sid, 1))
        chunk.events_json = '[{"t":12,"kind":"tick","playheads":{"A":12}}]'
        db.commit()
    result = get(b, f"sessions/{sid}", status=409)
    assert result["detail"] == "stored_chunk_integrity_mismatch"
    no_personal(b)


def test_migration_roundtrip_only_touches_generated_peer_tables(instance):
    from sqlalchemy import inspect
    peer = instance("migration-decoy")
    seed(peer, 1)
    cfg = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    with peer.engine.connect() as connection:
        cfg.attributes.update(connection=connection, configure_logger=False)
        assert len([name for name in inspect(connection).get_table_names() if name.startswith("peer_sync_")]) == 7
        command.downgrade(cfg, "0046_yumpp")
        assert not [name for name in inspect(connection).get_table_names() if name.startswith("peer_sync_")]
        command.upgrade(cfg, "head")
        assert len([name for name in inspect(connection).get_table_names() if name.startswith("peer_sync_")]) == 7
    with peer.sessions() as db:
        assert db.get(Track, 1).title == "Generated"


def test_concurrent_retries_and_explicit_identity_binding_conflicts(instance):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: post(b, "imports", packet), range(2)))
    assert sorted(result["duplicate"] for result in outcomes) == [False, True]
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    bind(b, 9, logical)
    guard = post(b, "tracks/1/select")["guard"]
    post(b, "tracks/1/bind", {"guard": guard, "logical_track_id": logical}, status=409)
    post(b, "tracks/1/identify", {"guard": "0" * 64}, status=409)
    identified = post(b, "tracks/1/identify", {"guard": guard})
    assert identified["logical_track_id"] != logical


@pytest.mark.parametrize("case", ["version", "duplicate-chunk", "undeclared-reference", "changed-chunk", "unknown-event"])
def test_invalid_exchange_rejects_without_partial_state(instance, case):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    if case == "version":
        packet["version"] = 2
    elif case == "duplicate-chunk":
        packet["chunks"].append(packet["chunks"][0])
    elif case == "undeclared-reference":
        packet["manifest"]["tracks"] = []
    elif case == "changed-chunk":
        packet["chunks"][0]["events"][0]["trackId"] = 2
    else:
        packet["chunks"][0]["events"][0]["kind"] = "unknown-next-version"
    post(b, "imports", packet, status=422)
    assert get(b, "sessions")["items"] == []
    no_personal(b)

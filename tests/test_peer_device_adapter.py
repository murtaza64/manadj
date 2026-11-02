"""Paired-device v1 adapter: resolved generation, scoped bytes and fresh row facts."""
import copy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.database import get_db
from backend.device_listener import PAIR_HEADER, build_app
from tests import test_peer_session_exchange as exchange
from tests.test_peer_session_exchange import bind, export, post, setup_pair

@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def device(peer):
    app = build_app(lambda: "test-code")

    def database():
        with peer.sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    return TestClient(app, headers={PAIR_HEADER: "test-code"})


def test_paired_adapter_states_detail_exact_bytes_and_no_owner_mutators(instance):
    a, b, ai, _, sid = setup_pair(instance)
    client = device(b)
    assert TestClient(client.app).get("/api/device-sync/peer-sessions").status_code == 401
    assert client.get("/api/device-sync/peer-sessions").json() == {"version": 1, "items": []}
    packet = export(a, sid, seqs=[0])
    post(b, "imports", packet)

    def state():
        listing = client.get("/api/device-sync/peer-sessions")
        assert listing.status_code == 200, listing.text
        assert listing.json()["version"] == 1
        return listing.json()["items"][0]

    assert state()["state"] == "partial_chunks"
    assert state()["replay_generation"] is None
    post(b, "imports", export(a, sid, seqs=[1]))
    assert state()["state"] == "unresolved_references"
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    bind(b, 9, logical)
    assert state()["state"] == "not_materialized"
    assert client.get(f"/api/device-sync/peer-sessions/{sid}", params={"generation": "old"}).status_code == 404
    post(b, f"sessions/{sid}/materialize")
    item = state()
    assert item["state"] == "ready" and item["materialized"] is True
    assert item["origin_replica_id"] == ai["replica_id"] and item["conflict_count"] == 0
    generation = item["replay_generation"]
    asset = packet["manifest"]["tracks"][0]["asset"]
    assert item["dependencies"] == [{"logical_track_id": logical, "local_track_id": 9,
        "asset_state": "exact", "sha256": asset["sha256"], "byte_length": asset["byte_length"]}]
    base = f"/api/device-sync/peer-sessions/{sid}"
    assert client.get(base).status_code == 422
    assert client.get(base, params={"generation": "wrong"}).status_code == 409
    detail = client.get(base, params={"generation": generation})
    assert detail.status_code == 200, detail.text
    detail = detail.json()
    assert detail["item"] == item
    assert detail["session"]["events"][0]["trackId"] == 9
    assert detail["session"]["replay_generation"] == generation
    assert detail["tracks"][0]["track"]["id"] == 9
    assert detail["tracks"][0]["track"]["title"] == "Generated"
    assert detail["tracks"][0]["sha256"] == asset["sha256"]
    audio = client.get(base + "/audio/9", params={"generation": generation})
    assert audio.status_code == 200 and audio.content == (b.root / "generated.wav").read_bytes()
    assert audio.headers["cache-control"] == "no-store"
    assert client.get(base + "/audio/1", params={"generation": generation}).status_code == 409
    assert client.get(base + "/audio/9", params={"generation": "wrong"}).status_code == 409
    assert client.get(f"/api/device-sync/sessions/{sid}").status_code == 409
    assert client.post(f"/api/peer-sync/sessions/{sid}/materialize", json={}).status_code == 404
    # Conflicting evidence remains separate, original selected source is still immutable/ready.
    altered = copy.deepcopy(packet)
    altered["manifest"]["ended_at"] = "2026-01-01T00:02:00Z"
    post(b, "imports", altered, status=409)
    assert state()["conflict_count"] == 1 and state()["state"] == "ready"
    # Metadata must come from the bound current row, not a stale phone snapshot.
    from backend.models import Track
    with b.sessions() as db:
        db.get(Track, 9).title = "Fresh current row"
        db.commit()
    assert client.get(base, params={"generation": generation}).json()["tracks"][0]["track"]["title"] == "Fresh current row"
    data = (b.root / "generated.wav").read_bytes()
    for unavailable in (b"short", b"x" * len(data)):
        (b.root / "generated.wav").write_bytes(unavailable)
        assert state()["state"] == "assets_unavailable"
        assert state()["replay_generation"] is None
        assert client.get(base, params={"generation": generation}).status_code == 409
        assert client.get(base + "/audio/9", params={"generation": generation}).status_code == 409
    (b.root / "generated.wav").unlink()
    assert state()["dependencies"][0]["asset_state"] == "missing"
    assert client.get(f"/api/device-sync/peer-sessions/{uuid4()}", params={"generation": generation}).status_code == 404


def test_paired_adapter_reused_id_same_bytes_stays_stale_until_explicit_rematerialize(instance):
    from backend.models import Track
    from backend.peer_sync.models import SyncSession
    from tests.test_peer_session_exchange import seed
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    post(b, "imports", packet)
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    bind(b, 9, logical)
    post(b, f"sessions/{sid}/materialize")
    client = device(b)
    old = client.get("/api/device-sync/peer-sessions").json()["items"][0]["replay_generation"]
    with b.sessions() as db:
        db.delete(db.get(Track, 9))
        db.commit()
    seed(b, 9)
    assert client.get("/api/device-sync/peer-sessions").json()["items"][0]["state"] == "unresolved_references"
    bind(b, 9, logical)
    assert client.get("/api/device-sync/peer-sessions").json()["items"][0]["state"] == "stale_binding"
    post(b, f"sessions/{sid}/materialize")
    new = client.get("/api/device-sync/peer-sessions").json()["items"][0]["replay_generation"]
    assert old != new
    assert client.get(f"/api/device-sync/peer-sessions/{sid}", params={"generation": old}).status_code == 409
    assert client.get(f"/api/device-sync/peer-sessions/{sid}", params={"generation": new}).status_code == 200
    with b.sessions() as db:
        db.get(SyncSession, sid).manifest_json = "{}"
        db.commit()
    assert client.get("/api/device-sync/peer-sessions").json()["items"][0]["state"] == "source_invalid"
    assert client.get(f"/api/device-sync/peer-sessions/{sid}", params={"generation": new}).status_code == 409


def test_legacy_list_never_advertises_peer_uuid_even_if_peer_intake_fails(instance, monkeypatch):
    from tests.test_peer_history_integration import history
    from tests.test_peer_session_exchange import seed
    a, b, _, _, sid = setup_pair(instance)
    # The phone can already have A's immutable ended cache with source Track1.
    assert [row["uuid"] for row in device(a).get("/api/device-sync/sessions").json()] == [sid]
    source_log = device(a).get(f"/api/device-sync/sessions/{sid}").json()
    assert source_log["events"][0]["trackId"] == 1
    local_sid = str(uuid4())
    seed(b, 10, session_uuid=local_sid, filename="receiver-own.wav")
    before = device(b).get("/api/device-sync/sessions").json()
    packet = export(a, sid)
    post(b, "imports", packet)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    post(b, f"sessions/{sid}/materialize")
    receiver = device(b)
    assert receiver.get("/api/device-sync/sessions").json() == before
    assert [row["uuid"] for row in before] == [local_sid]
    assert {row["uuid"] for row in history(b).get("/api/sessions").json()} == {sid, local_sid}
    assert receiver.get("/api/device-sync/peer-sessions").json()["items"][0]["session_uuid"] == sid
    assert history(b).get(f"/api/sessions/{sid}").json()["events"][0]["trackId"] == 9

    from backend.peer_sync import device as adapter
    from fastapi import HTTPException

    def unavailable(_db):
        raise HTTPException(503, "decoy_peer_intake_unavailable")

    monkeypatch.setattr(adapter, "list_peer_sessions", unavailable)
    assert receiver.get("/api/device-sync/peer-sessions").status_code == 503
    # A failed separate intake cannot re-advertise the unmarked foreign-ID cache UUID.
    assert receiver.get("/api/device-sync/sessions").json() == before
    assert receiver.get(f"/api/device-sync/sessions/{sid}").status_code == 409

"""Normal history is a non-playable projection, never a foreign-ID fallback."""
import json
from pathlib import Path
from uuid import uuid4

import pytest

from backend.models import Session as RecordedSession
from backend.models import SessionChunk, Track
from backend.peer_sync.group_contracts import Operation, Signed, encode, sign, unpack
from backend.peer_sync.group_history import owns_uuid
from backend.peer_sync.models import GroupHistory, GroupOperation
from tests.test_device_group_mesh import call, push, setup, signed_body
from tests.test_peer_history_integration import history
from tests.test_peer_session_exchange import bind, export, post, seed
from tests.test_peer_session_exchange import instance as instance  # noqa: PLC0414


def test_full_shared_fixture_is_exact_authenticated_complete_session():
    from backend.peer_sync.service import validate_complete
    from scripts.group_session_fixture import fixture
    static = json.loads((Path(__file__).parent / "fixtures/group_session_v1.json").read_text())
    assert static == fixture()
    operation, _, hashed = unpack(Signed(body_b64=encode(static["body_utf8"].encode()),
                                       signature_b64=static["signature_b64"]), Operation)
    assert hashed == static["sha256"]
    assert len(operation.bundle.manifest.tracks) == len(operation.bundle.chunks) == 2
    assert validate_complete(operation.bundle.manifest, {c.seq: c.events for c in operation.bundle.chunks})


def test_normal_history_automatic_projection_relay_restart_and_no_playable_ids(instance):
    (a, phone, b), gid, ids, _ = setup(instance)
    for peer in (a, phone, b):
        for label, identity in zip(("Laptop A", "Phone", "Laptop B"), ids):
            call(peer, gid, "pin_member", identity["device_id"], identity["public_key_b64"], label)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    bundle = export(a, sid)
    issued = call(a, gid, "issue", sid)
    push(a, phone, gid, ids[1]["device_id"], issued)
    push(phone, b, gid, ids[2]["device_id"], issued)
    for peer, relays in [(phone, []), (b, ["Phone"])]:
        normal = history(peer)
        row = normal.get("/api/sessions").json()[0]
        assert row["uuid"] == sid and row["group_history"][0]["origin"]["label"] == "Laptop A"
        view = row["group_history"][0]
        assert view["status"] == "unbound" and view["projected"]
        assert not view["playable"] and not view["editable"]
        assert [relay["label"] for relay in view["relays"]] == relays
        detail = normal.get(f"/api/sessions/{sid}").json()
        assert detail["events"] == [] and detail["replay_generation"] is None
        with peer.sessions() as db:
            assert db.query(RecordedSession).count() == db.query(GroupHistory).count() == 1
            assert db.query(SessionChunk).count() == 0
        assert history(instance(peer.root.name)).get(f"/api/sessions/{sid}").json() == detail
    # Exact explicitly guarded binding changes metadata status, NOT playback.
    seed(b, 99)
    bind(b, 99, bundle["manifest"]["tracks"][0]["logical_track_id"])
    detail = history(b).get(f"/api/sessions/{sid}").json()
    assert detail["group_history"][0]["status"] == "metadata-ready"
    assert detail["events"] == [] and not detail["group_history"][0]["playable"]
    assert history(b).get(f"/api/sessions/{sid}/audio/99?generation=anything").status_code == 409
    with b.sessions() as db:
        db.delete(db.get(Track, 99))
        db.commit()
    seed(b, 99, filename="reused.wav")
    assert history(b).get(f"/api/sessions/{sid}").json()["group_history"][0]["status"] == "unbound"
    # Original local source and unrelated existing Sessions keep their reader.
    assert history(a).get(f"/api/sessions/{sid}").json()["events"][0]["trackId"] == 1


@pytest.mark.parametrize("failure", ["history-commit", "revoked", "missing-ledger", "tampered-signature", "collision"])
def test_uuid_authority_survives_projection_failure_revocation_missing_and_collision(instance, monkeypatch, failure):
    (a, phone, _), gid, ids, _ = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    if failure == "collision":
        seed(phone, 1, session_uuid=sid)
    if failure == "history-commit":
        import backend.peer_sync.group_history as projection
        real_project = projection.project

        def fail(db, group_id, operation_id):
            # Fail only the derived projection, AFTER ledger durability.
            db.add(RecordedSession(uuid=sid))
            db.flush()
            raise OSError("generated projection storage failure")
        monkeypatch.setattr(projection, "project", fail)
    push(a, phone, gid, ids[1]["device_id"], issued)
    if failure == "history-commit":
        monkeypatch.setattr(projection, "project", real_project)
    elif failure == "revoked":
        call(phone, gid, "revoke", ids[0]["device_id"])
    elif failure in ("missing-ledger", "tampered-signature"):
        with phone.sessions() as db:
            row = db.query(GroupOperation).one()
            if failure == "missing-ledger":
                db.delete(row)
            else:
                row.signature_b64 = encode(bytes(64))
            db.commit()
    normal = history(phone)
    detail = normal.get(f"/api/sessions/{sid}").json()
    expected = {"history-commit": "projection-pending", "revoked": "revoked", "missing-ledger": "invalid",
                "tampered-signature": "invalid", "collision": "conflicted"}[failure]
    assert detail["group_history"][0]["status"] == expected
    assert detail["events"] == [] and not detail["group_history"][0]["playable"]
    with phone.sessions() as db:
        assert owns_uuid(db, sid)
        from fastapi import HTTPException

        from backend.session_source import deny_peer_derivation, preview_source
        with pytest.raises(HTTPException):
            preview_source(db, sid)
        with pytest.raises(HTTPException):
            deny_peer_derivation(db, sid)
    assert normal.post("/api/sessions", json={"uuid": sid}).status_code == 409
    assert normal.post(f"/api/sessions/{sid}/chunks", json={"seq": 0, "events": []}).status_code == 409
    assert normal.patch(f"/api/sessions/{sid}/end", json={}).status_code == 409
    assert normal.delete(f"/api/sessions/{sid}").status_code == 409
    from backend.routers.device_sync import router
    normal.app.include_router(router, prefix="/api/device-sync")
    assert normal.get(f"/api/device-sync/sessions/{sid}").status_code == 409
    assert normal.post(f"/api/device-sync/sessions/{sid}", json={"started_at": "2026-01-01T00:00:00", "chunks": []}).status_code == 409
    assert all(row["uuid"] != sid for row in normal.get("/api/device-sync/sessions").json())
    marker = next(item for item in normal.get("/api/device-sync/peer-sessions").json()["items"] if item["session_uuid"] == sid)
    assert marker["group_managed"] and marker["state"] == "group_metadata_only"
    assert marker["materialized"] is False and marker["replay_generation"] is None and marker["dependencies"] == []
    assert normal.get(f"/api/device-sync/peer-sessions/{sid}?generation=anything").status_code == 409
    with phone.sessions() as db:
        count = db.query(SessionChunk).count()
    normal.post("/api/sessions/recover")
    with phone.sessions() as db:
        assert db.query(SessionChunk).count() == count  # don't delete evidence to hide a collision
    if failure == "history-commit":
        result = post(phone, "group-history/project", {"group_id": gid, "operation_id": str(unpack(issued, Operation)[0].operation_id)})
        assert result["playable"] is False
        assert normal.get(f"/api/sessions/{sid}").json()["group_history"][0]["status"] == "unbound"


def test_incompatible_same_uuid_preserves_both_signed_ops_and_existing_projection(instance):
    (a, phone, _), gid, ids, seeds = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    push(a, phone, gid, ids[1]["device_id"], issued)
    changed = signed_body(issued)
    changed["operation_id"] = str(uuid4())
    changed["bundle"]["manifest"]["recording_origin"] = "Concurrent source"
    envelope = {"format": "manadj-device-group/v1", "group_id": gid, "origin_device_id": ids[0]["device_id"],
                "kind": "deliver", "recipient_device_id": ids[1]["device_id"], "operation": sign(changed, seeds[0]).model_dump()}
    from tests.test_device_group_mesh import http
    http(phone, gid, "deliver", sign(envelope, seeds[0]))
    detail = history(phone).get(f"/api/sessions/{sid}").json()
    assert len(detail["group_history"]) == 2 and all(v["status"] == "conflicted" for v in detail["group_history"])
    assert len(history(phone).get("/api/sessions").json()) == 1
    with phone.sessions() as db:
        assert db.query(GroupOperation).count() == 2 and db.query(RecordedSession).count() == 1
        assert db.query(SessionChunk).count() == 0

"""Generated assets, independent migrated replicas; never real devices or data."""
import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.peer_sync.group import GroupSync
from backend.peer_sync.group_contracts import Operation, Page, Signed, decode, encode, sign, unpack
from backend.peer_sync.models import (
    GroupAck,
    GroupOperation,
    SyncChunk,
    SyncConflict,
    SyncSession,
    SyncSource,
)
from backend.peer_sync.service import SyncError
from tests.test_peer_session_exchange import bind, export, get, post, seed
from tests.test_peer_session_exchange import instance as instance  # noqa: PLC0414 (fixture registration)


def call(peer, gid, method, *args):
    with peer.sessions() as db:
        return getattr(GroupSync(db, gid), method)(*args)


def signed_body(signed):
    return json.loads(decode(signed.body_b64))


def setup(instance):
    peers = [instance(name) for name in ("a", "phone", "b")]
    gid = str(uuid4())
    identities = []
    seeds = [bytes([n]) * 32 for n in (1, 2, 3)]
    for peer, private in zip(peers, seeds):
        post(peer, "identity")
        identities.append(call(peer, gid, "provision", private))
        from backend.peer_sync.group_router import router
        peer.client.app.include_router(router, prefix="/api/device-groups")
    for peer in peers:
        for identity in identities:
            call(peer, gid, "pin_member", identity["device_id"], identity["public_key_b64"])
    return peers, gid, identities, seeds


def http(peer, gid, path, signed, status=200):
    response = peer.client.post(f"/api/device-groups/{gid}/{path}", json=signed.model_dump())
    assert response.status_code == status, response.text
    return Signed.model_validate(response.json()) if status == 200 and path != "ack" else response.json()


def push(sender, receiver, gid, recipient, operation):
    oid = str(unpack(operation, Operation)[0].operation_id)
    delivery = call(sender, gid, "delivery", recipient, oid)
    ack = http(receiver, gid, "deliver", delivery)
    http(sender, gid, "ack", ack)
    return ack


def test_three_replica_disconnected_relay_reverse_restart_retry_ids_assets(instance):
    (a, phone, b), gid, ids, _ = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    original = export(a, sid)
    issued = call(a, gid, "issue", sid)
    op = unpack(issued, Operation)[0]
    # Only A↔phone and phone↔B paths exist in this test.
    push(a, phone, gid, ids[1]["device_id"], issued)
    push(phone, b, gid, ids[2]["device_id"], issued)
    assert call(a, gid, "issue", sid) == issued
    for peer in (phone, b):
        assert call(peer, gid, "project", op.operation_id)["state"] == "stored_complete"
        assert get(peer, f"sessions/{sid}")["state"] == "unresolved_references"
        with peer.sessions() as db:
            assert db.query(SyncSource).count() == 0  # not legacy namespace authority
    logical = original["manifest"]["tracks"][0]["logical_track_id"]
    for peer in (phone, b):
        seed(peer, 1, filename="unrelated.wav")
        asset = seed(peer, 9)
        assert not get(peer, f"sessions/{sid}")["dependencies_ready"]
        bind(peer, 9, logical)
        detail = get(peer, f"sessions/{sid}")
        assert detail["dependencies_ready"] and detail["session"]["events"][0]["trackId"] == 9
        original_bytes = asset.read_bytes()
        asset.unlink()
        assert not get(peer, f"sessions/{sid}")["dependencies_ready"]
        asset.write_bytes(b"x" * len(original_bytes))
        assert get(peer, f"sessions/{sid}")["dependencies"][0]["asset_state"] == "changed"
        asset.write_bytes(original_bytes)
    # A real independent reverse-origin Session, not an echo/re-mint of A.
    reverse_sid = str(uuid4())
    seed(b, 20, session_uuid=reverse_sid, filename="reverse.wav")
    export(b, reverse_sid)
    reverse = call(b, gid, "issue", reverse_sid)
    push(b, phone, gid, ids[1]["device_id"], reverse)
    push(phone, a, gid, ids[0]["device_id"], reverse)
    for peer in (phone, a):
        call(peer, gid, "project", unpack(reverse, Operation)[0].operation_id)
    # Recreate engines, session factories and adapters, retaining only DBs.
    a, phone, b = [instance(name) for name in ("a", "phone", "b")]
    from backend.peer_sync.group_router import router
    for peer in (a, phone, b):
        peer.client.app.include_router(router, prefix="/api/device-groups")
    push(a, phone, gid, ids[1]["device_id"], issued)
    push(phone, b, gid, ids[2]["device_id"], issued)
    for peer in (a, phone, b):
        with peer.sessions() as db:
            rows = db.query(GroupOperation).order_by(GroupOperation.operation_id).all()
            assert len(rows) == 2
            assert {row.body_b64 for row in rows} == {issued.body_b64, reverse.body_b64}
            assert {row.signature_b64 for row in rows} == {issued.signature_b64, reverse.signature_b64}
    with phone.sessions() as db:
        assert db.get(GroupAck, (gid, str(op.operation_id), ids[2]["device_id"])) is not None
    snapshots = []
    for peer in (a, phone, b):
        with peer.sessions() as db:
            snapshots.append([(row.session_uuid, row.manifest_sha256, row.manifest_json)
                              for row in db.query(SyncSession).order_by(SyncSession.session_uuid)])
    assert snapshots[0] == snapshots[1] == snapshots[2]
    # Independent interpreter reads the durable ledger, not retained ORM state.
    probe = subprocess.run([sys.executable, "-c", """
import json, sys
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend.peer_sync.models import GroupOperation, GroupAck
with Session(create_engine(sys.argv[1])) as db:
    print(json.dumps({'bytes': sorted(row.body_b64 for row in db.query(GroupOperation)),
                      'acks': db.query(GroupAck).count()}))
""", str(phone.engine.url)], check=True, text=True, capture_output=True)
    fresh = json.loads(probe.stdout)
    assert fresh["bytes"] == sorted([issued.body_b64, reverse.body_b64]) and fresh["acks"] == 2
    # B has acknowledged A's evidence; phone never echoes that evidence back.
    request = call(b, gid, "pull_request", ids[1]["device_id"])
    page = http(phone, gid, "pull", request)
    assert unpack(page, Page)[0].operations == []


def test_explicit_projection_preserves_concurrent_immutable_conflict(instance):
    (a, phone, _), gid, ids, seeds = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    oid = unpack(issued, Operation)[0].operation_id
    push(a, phone, gid, ids[1]["device_id"], issued)
    call(phone, gid, "project", oid)
    # Another independently signed create based on absence is NOT an update or
    # wall-clock winner. Both operations survive; projection records conflict.
    body = signed_body(issued)
    body["operation_id"] = str(uuid4())
    body["bundle"]["manifest"]["recording_origin"] = "concurrent evidence"
    other = sign(body, seeds[0])
    envelope = {"format": "manadj-device-group/v1", "group_id": gid,
                "origin_device_id": ids[0]["device_id"], "kind": "deliver",
                "recipient_device_id": ids[1]["device_id"], "operation": other.model_dump()}
    http(phone, gid, "deliver", sign(envelope, seeds[0]))
    with pytest.raises(SyncError) as error:
        call(phone, gid, "project", body["operation_id"])
    assert error.value.code == "immutable_session_conflict_preserved"
    with phone.sessions() as db:
        assert db.query(GroupOperation).count() == 2
        assert db.query(SyncConflict).count() == 1
        assert db.get(SyncSession, sid).manifest_json == json.dumps(
            unpack(issued, Operation)[0].bundle.manifest.model_dump(mode="json"),
            sort_keys=True, separators=(",", ":"))
        assert db.query(SyncChunk).count() == 2
    with pytest.raises(SyncError) as error:
        call(phone, gid, "issue", sid)
    assert error.value.code == "export_local_session_first"


def test_deleted_reused_local_integer_never_transitively_binds(instance):
    from backend.models import Track
    (a, phone, _), gid, ids, _ = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    bundle = export(a, sid)
    issued = call(a, gid, "issue", sid)
    push(a, phone, gid, ids[1]["device_id"], issued)
    call(phone, gid, "project", unpack(issued, Operation)[0].operation_id)
    seed(phone, 1)  # foreign sender integer collides; still unbound
    assert not get(phone, f"sessions/{sid}")["dependencies_ready"]
    bind(phone, 1, bundle["manifest"]["tracks"][0]["logical_track_id"])
    assert get(phone, f"sessions/{sid}")["dependencies_ready"]
    with phone.sessions() as db:
        db.delete(db.get(Track, 1))
        db.commit()
    seed(phone, 1, filename="reused.wav")
    assert get(phone, f"sessions/{sid}")["state"] == "unresolved_references"


@pytest.mark.parametrize("mutation,status", [("hash", 409), ("operation", 409), ("recipient", 403), ("signer", 403)])
def test_ack_cannot_suppress_unacknowledged_peer_evidence(instance, mutation, status):
    (a, phone, _), gid, ids, seeds = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    delivery = call(a, gid, "delivery", ids[1]["device_id"], unpack(issued, Operation)[0].operation_id)
    ack = http(phone, gid, "deliver", delivery)
    body = signed_body(ack)
    if mutation == "hash":
        body["operation_sha256"] = "0" * 64
    elif mutation == "operation":
        body["operation_id"] = str(uuid4())
    elif mutation == "recipient":
        body["recipient_device_id"] = ids[2]["device_id"]
    else:
        body["origin_device_id"] = str(uuid4())
    http(a, gid, "ack", sign(body, seeds[1]), status=status)
    with a.sessions() as db:
        assert db.query(GroupAck).count() == 0
    request = call(phone, gid, "pull_request", ids[0]["device_id"])
    assert len(unpack(http(a, gid, "pull", request), Page)[0].operations) == 1


def test_pagination_does_not_lose_independent_operations_and_revocation_survives_restart(instance):
    (a, phone, _), gid, ids, _ = setup(instance)
    for n in range(3):
        sid = str(uuid4())
        seed(a, n + 1, session_uuid=sid, filename=f"source{n}.wav")
        export(a, sid)
        call(a, gid, "issue", sid)
    after, seen = 0, []
    while True:
        request = call(phone, gid, "pull_request", ids[0]["device_id"], after)
        page = http(a, gid, "pull", request)
        seen.extend(unpack(page, Page)[0].operations)
        result = call(phone, gid, "receive_page", page, request)
        for ack in result["acks"]:
            http(a, gid, "ack", ack)
        after = result["next_after"]
        if not result["more"]:
            break
    assert len(seen) == len({s.body_b64 for s in seen}) == 3
    call(phone, gid, "revoke", ids[0]["device_id"])
    phone = instance("phone")
    with pytest.raises(SyncError):
        call(phone, gid, "pull_request", ids[0]["device_id"])
    with phone.sessions() as db:
        assert db.query(GroupOperation).count() == 3  # retained, not deleted


def test_foreground_pull_ack_and_request_binding(instance):
    (a, phone, b), gid, ids, _ = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    request = call(phone, gid, "pull_request", ids[0]["device_id"])
    page = http(a, gid, "pull", request)
    result = call(phone, gid, "receive_page", page, request)
    assert len(result["acks"]) == 1
    http(a, gid, "ack", result["acks"][0])
    assert unpack(http(a, gid, "pull", request), Page)[0].operations == []
    wrong_request = call(phone, gid, "pull_request", ids[0]["device_id"])
    with pytest.raises(SyncError) as error:
        call(phone, gid, "receive_page", page, wrong_request)
    assert error.value.code == "group_page_request_mismatch"
    # Phone can relay same issuer bytes to B without listening itself.
    push(phone, b, gid, ids[2]["device_id"], issued)


def test_unknown_revoked_forged_group_recipient_and_equivocation(instance):
    (a, phone, b), gid, ids, seeds = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    oid = unpack(issued, Operation)[0].operation_id
    delivery = call(a, gid, "delivery", ids[1]["device_id"], oid)
    forged = delivery.model_copy(update={"signature_b64": encode(bytes(64))})
    http(phone, gid, "deliver", forged, status=403)
    body = signed_body(delivery)
    body["origin_device_id"] = str(uuid4())
    http(phone, gid, "deliver", sign(body, seeds[0]), status=403)
    body = signed_body(delivery)
    body["recipient_device_id"] = ids[2]["device_id"]
    http(phone, gid, "deliver", sign(body, seeds[0]), status=403)
    body["recipient_device_id"] = ids[1]["device_id"]
    body["group_id"] = str(uuid4())
    http(phone, gid, "deliver", sign(body, seeds[0]), status=403)
    # Trusted relay cannot forge the original member's operation.
    inner = signed_body(issued)
    inner["operation_id"] = str(uuid4())
    body = signed_body(delivery)
    body["operation"] = sign(inner, seeds[1]).model_dump()
    http(phone, gid, "deliver", sign(body, seeds[0]), status=403)
    push(a, phone, gid, ids[1]["device_id"], issued)
    inner = signed_body(issued)
    inner["bundle"]["manifest"]["recording_origin"] = "equivocation"
    body["operation"] = sign(inner, seeds[0]).model_dump()
    http(phone, gid, "deliver", sign(body, seeds[0]), status=409)
    inner["parents"] = ["0" * 64]
    body["operation"] = sign(inner, seeds[0]).model_dump()
    http(phone, gid, "deliver", sign(body, seeds[0]), status=422)
    # Revoke original A on B; P remains trusted but cannot relay A thereafter.
    call(b, gid, "revoke", ids[0]["device_id"])
    delivery = call(phone, gid, "delivery", ids[2]["device_id"], oid)
    http(b, gid, "deliver", delivery, status=403)
    with pytest.raises(SyncError):
        call(b, gid, "pin_member", ids[0]["device_id"], ids[0]["public_key_b64"])
    with b.sessions() as db:
        assert db.query(GroupOperation).count() == 0
    # Revoke relay P separately; original validity does not authorize transport.
    call(b, gid, "revoke", ids[1]["device_id"])
    http(b, gid, "deliver", delivery, status=403)


def test_signed_bytes_reject_duplicates_unknown_fields_and_partial_bundle(instance):
    (a, phone, _), gid, ids, seeds = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    issued = call(a, gid, "issue", sid)
    body = signed_body(issued)
    body["bundle"]["chunks"] = body["bundle"]["chunks"][:1]
    bad = sign(body, seeds[0])
    envelope = {"format": "manadj-device-group/v1", "group_id": gid,
                "origin_device_id": ids[0]["device_id"], "kind": "deliver",
                "recipient_device_id": ids[1]["device_id"], "operation": bad.model_dump()}
    http(phone, gid, "deliver", sign(envelope, seeds[0]), status=422)
    envelope["trust"] = {"admin": True}
    http(phone, gid, "deliver", sign(envelope, seeds[0]), status=422)
    raw = b'{"kind":"deliver","kind":"ack"}'
    key = Ed25519PrivateKey.from_private_bytes(seeds[0])
    from backend.peer_sync.group_contracts import DOMAIN
    duplicate = Signed(body_b64=encode(raw), signature_b64=encode(key.sign(DOMAIN + raw)))
    http(phone, gid, "deliver", duplicate, status=422)
    noncanonical = json.dumps(signed_body(issued), indent=2).encode()
    noncanonical = Signed(body_b64=encode(noncanonical), signature_b64=encode(key.sign(DOMAIN + noncanonical)))
    envelope.pop("trust")
    envelope["operation"] = noncanonical.model_dump()
    http(phone, gid, "deliver", sign(envelope, seeds[0]), status=422)


def test_shared_ed25519_opaque_byte_vectors():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    from backend.peer_sync.group_contracts import DOMAIN, Ack, Pull
    from scripts.device_group_vectors import vectors
    fixture = json.loads((Path(__file__).parent / "fixtures/device_group_v1.json").read_text())
    generated = vectors()
    assert fixture["domain_hex"] == generated["domain_hex"]
    assert fixture["keys"] == generated["keys"]
    models = {"operation": Operation, "ack": Ack, "pull": Pull}
    for name, item in fixture["messages"].items():
        expected = generated["messages"][name]
        assert item["body_utf8"].encode() == decode(expected["body_b64"])
        assert item["signature_b64"] == expected["signature_b64"]
        assert item["sha256"] == expected["sha256"]
        signed = Signed(body_b64=encode(item["body_utf8"].encode()), signature_b64=item["signature_b64"])
        parsed, raw, hashed = unpack(signed, models[name])
        assert hashed == item["sha256"]
        key = next(key for key in fixture["keys"] if key["device_id"] == str(parsed.origin_device_id))
        Ed25519PublicKey.from_public_bytes(decode(key["public_key_b64"])).verify(decode(signed.signature_b64), DOMAIN + raw)


def test_generated_http_fixture_restart_has_same_issuer_bytes_and_keys(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from tests.device_group_app import create_app
    monkeypatch.setenv("MANADJ_GROUP_FIXTURE_ROOT", str(tmp_path / "http-fixture"))
    with TestClient(create_app()) as client:
        first = client.get("/").json()
        status = client.get("/status").json()
        assert first["generated_only"]
        assert [len(status[n]["operations"]) for n in ("a", "phone", "b")] == [1, 0, 1]
        assert client.get("/a/openapi.json").status_code == 200
    with TestClient(create_app()) as client:
        assert client.get("/").json() == first
        assert client.get("/status").json() == status

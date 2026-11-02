"""Migrated isolated receiver stores and locally generated, valid audio only."""
import json
from datetime import datetime
from uuid import uuid4

import pytest

from backend.models import Track
from backend.peer_sync.group_contracts import Signed, encode, sign
from backend.peer_sync.models import GroupOperation
from scripts.group_replay_fixture import fixture, wav_bytes
from tests.test_device_group_mesh import call, http
from tests.test_peer_history_integration import history
from tests.test_peer_session_exchange import get, post
from tests.test_peer_session_exchange import instance as instance  # noqa: PLC0414


def receiver(instance):
    peer = instance("replay456")
    value = fixture()
    body = json.loads(value["body_utf8"])
    gid, oid = body["group_id"], body["operation_id"]
    post(peer, "identity")
    identity = call(peer, gid, "provision", bytes([87]) * 32)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from backend.peer_sync.group_router import router
    peer.client.app.include_router(router, prefix="/api/device-groups")
    key = Ed25519PrivateKey.from_private_bytes(bytes(range(32))).public_key().public_bytes_raw()
    call(peer, gid, "pin_member", body["origin_device_id"], encode(key), "Synthetic origin")
    signed = Signed(body_b64=encode(value["body_utf8"].encode()), signature_b64=value["signature_b64"])
    delivery = {"format": "manadj-device-group/v1", "group_id": gid, "origin_device_id": body["origin_device_id"],
                "kind": "deliver", "recipient_device_id": identity["device_id"], "operation": signed.model_dump()}
    http(peer, gid, "deliver", sign(delivery, bytes(range(32))))
    for local, asset in zip((73, 88), value["assets"]):
        recipe = asset["recipe"]
        path = peer.root / asset["file_name"]
        path.write_bytes(wav_bytes(recipe["period_frames"], recipe["amplitude"]))
        with peer.sessions() as db:
            db.add(Track(id=local, filename=str(path), title=asset["file_name"], bpm=12000))
            db.commit()
    return peer, value, f"group-replay/{gid}/{oid}"


def bound(instance):
    peer, value, path = receiver(instance)
    selections = []
    for local, asset in zip((73, 88), value["assets"]):
        selection = post(peer, f"group-replay/selections/{local}")
        selections.append(selection)
        post(peer, path + "/bindings", {"logical_track_id": asset["logical_track_id"],
             "selection_id": selection["selection_id"], "incarnation": selection["incarnation"]})
    return peer, value, path, selections


def test_exact_bound_receiver_bytes_restart_and_metadata_stays_nonplayable(instance):
    peer, value, path, _ = bound(instance)
    readiness = get(peer, path + "/readiness")
    assert readiness["state"] == "candidate-exact" and readiness["playable"] is False
    generation = readiness["generation"]
    source = get(peer, path + f"/source?generation={generation}")
    assert {e["trackId"] for e in source["events"] if e["kind"] == "load"} == {73, 88}
    assert not source["playable"]
    for asset in value["assets"]:
        response = peer.client.get(f'/api/peer-sync/{path}/audio/{asset["logical_track_id"]}?generation={generation}')
        assert response.status_code == 200
        assert response.content == (peer.root / asset["file_name"]).read_bytes()
        assert response.headers["cache-control"] == "no-store"
    restarted = instance(peer.root.name)
    assert get(restarted, path + "/readiness") == readiness
    sid = source["identity"]["session_uuid"]
    detail = history(peer).get(f"/api/sessions/{sid}").json()
    assert detail["events"] == [] and detail["replay_generation"] is None
    assert history(peer).get(f"/api/sessions/{sid}/audio/73?generation={generation}").status_code == 409


@pytest.mark.parametrize("mutation", ["replace-identical", "overwrite", "archive", "delete-reuse", "revoke", "signature", "missing", "row-path"])
def test_current_authority_refuses_changed_or_replaced_receiver(instance, mutation):
    peer, value, path, _ = bound(instance)
    generation = get(peer, path + "/readiness")["generation"]
    asset = peer.root / value["assets"][0]["file_name"]
    if mutation == "replace-identical":
        replacement = peer.root / "new-decoy.wav"
        replacement.write_bytes(asset.read_bytes())
        replacement.replace(asset)
    elif mutation == "overwrite":
        asset.write_bytes(b"not the selected audio")
    elif mutation == "missing":
        asset.unlink()
    elif mutation == "revoke":
        body = json.loads(value["body_utf8"])
        call(peer, body["group_id"], "revoke", body["origin_device_id"])
    else:
        with peer.sessions() as db:
            row = db.get(Track, 73)
            if mutation == "archive":
                row.archived_at = datetime(2026, 1, 1)
            elif mutation == "delete-reuse":
                db.delete(row)
                db.flush()
                db.add(Track(id=73, filename=str(asset), title="Reused"))
            elif mutation == "row-path":
                other = peer.root / "other.wav"
                other.write_bytes(asset.read_bytes())
                row.filename = str(other)
            else:
                db.query(GroupOperation).one().signature_b64 = encode(bytes(64))
            db.commit()
    state = get(peer, path + "/readiness")
    assert state["state"] != "candidate-exact" and state["generation"] is None and not state["playable"]
    denied = 403 if mutation in ("revoke", "signature") else 409
    get(peer, path + f"/source?generation={generation}", status=denied)
    response = peer.client.get(f'/api/peer-sync/{path}/audio/{value["assets"][0]["logical_track_id"]}?generation={generation}')
    assert response.status_code == denied


def test_explicit_binding_rejects_wrong_selection_identity_and_stale_generation(instance):
    peer, value, path = receiver(instance)
    assert get(peer, path + "/readiness")["state"] == "unbound"
    selection = post(peer, "group-replay/selections/73")
    body = {"logical_track_id": value["assets"][0]["logical_track_id"], "selection_id": selection["selection_id"],
            "incarnation": selection["incarnation"]}
    post(peer, path + "/bindings", {**body, "incarnation": "0" * 64}, status=409)
    post(peer, path + "/bindings", {**body, "selection_id": str(uuid4())}, status=409)
    post(peer, path + "/bindings", {**body, "logical_track_id": value["assets"][1]["logical_track_id"]}, status=409)
    post(peer, path + "/bindings", {**body, "decoded": True}, status=422)
    post(peer, path + "/bindings", body)
    selection_b = post(peer, "group-replay/selections/88")
    post(peer, path + "/bindings", {"logical_track_id": value["assets"][1]["logical_track_id"],
        "selection_id": selection_b["selection_id"], "incarnation": selection_b["incarnation"]})
    get(peer, path + "/source?generation=old", status=409)


def test_selection_strict_body_and_local_owner_gate(instance):
    peer, _, _ = receiver(instance)
    post(peer, "group-replay/selections/73", {"decoded": True}, status=422)
    response = peer.client.post("/api/peer-sync/group-replay/selections/73", content="{", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    response = peer.client.post("/api/peer-sync/group-replay/selections/73", json={}, headers={"Origin": "https://peer.example"})
    assert response.status_code == 403


@pytest.mark.parametrize("corruption", ["device-id", "local-id", "local-pin", "private-seed"])
def test_corrupt_local_authority_never_reclassifies_received_evidence_as_own_raw_history(instance, corruption):
    from backend.peer_sync.models import DeviceGroup, GroupMember, SyncLocal
    from backend.peer_sync.service import SyncError
    from tests.test_device_group_mesh import push, setup
    from tests.test_peer_session_exchange import export, seed
    (a, phone, _), gid, ids, _ = setup(instance)
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    export(a, sid)
    seed(phone, 1, session_uuid=sid)
    issued = call(a, gid, "issue", sid)
    push(a, phone, gid, ids[1]["device_id"], issued)
    with phone.sessions() as db:
        group = db.get(DeviceGroup, gid)
        if corruption == "device-id":
            group.device_id = ids[0]["device_id"]
        elif corruption == "local-id":
            db.get(SyncLocal, 1).replica_id = ids[0]["device_id"]
        elif corruption == "local-pin":
            db.get(GroupMember, (gid, group.device_id)).public_key_b64 = ids[0]["public_key_b64"]
        else:
            group.private_seed_b64 = encode(bytes(32))
        db.commit()
    with pytest.raises(SyncError):
        call(phone, gid, "_local")
    normal = history(phone)
    detail = normal.get(f"/api/sessions/{sid}").json()
    assert detail["events"] == [] and detail["replay_generation"] is None and detail["group_history"]
    assert normal.get(f"/api/sessions/{sid}/audio/1?generation=anything").status_code == 409
    assert normal.post(f"/api/sessions/{sid}/chunks", json={"seq": 2, "events": []}).status_code == 409

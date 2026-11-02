"""Print deterministic interoperability vectors; seeds are PUBLIC TEST DATA."""
import hashlib
import json

import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.peer_sync.group_contracts import DOMAIN, encode, sign


def vectors():
    a, b = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
    gid = "33333333-3333-4333-8333-333333333333"
    oid = "44444444-4444-4444-8444-444444444444"
    seed_a, seed_b = bytes(range(32)), bytes(range(32, 64))
    common = {"format": "manadj-device-group/v1", "group_id": gid, "origin_device_id": a}
    events = [{"bpm": 174, "channel": "A", "kind": "load", "t": 0, "trackId": 7},
              {"action": "play", "channel": "A", "kind": "transport", "playhead": 0, "t": 0.25}]
    bundle = {"format": "manadj-peer-session", "version": 1, "digest_algorithm": "sha256-rfc8785-jcs-v1",
        "manifest": {"session_uuid": "55555555-5555-4555-8555-555555555555", "origin_replica_id": a,
            "grammar": "capture-events-v1", "reference_basis": "explicit-current-row-bindings",
            "started_at": "2026-01-01T00:00:00Z", "ended_at": "2026-01-01T00:01:00Z", "recording_origin": "vector",
            "tracks": [{"source_local_id": 7, "logical_track_id": "66666666-6666-4666-8666-666666666666",
                        "asset": None}], "chunk_sha256": [hashlib.sha256(rfc8785.dumps(events)).hexdigest()]},
        "chunks": [{"seq": 0, "events": events}]}
    operation = {**common, "kind": "session-create", "operation_id": oid, "parents": [], "bundle": bundle}
    op_signed = sign(operation, seed_a)
    hashed = hashlib.sha256(rfc8785.dumps(operation)).hexdigest()
    bodies = {"operation": operation,
        "delivery": {**common, "kind": "deliver", "recipient_device_id": b, "operation": op_signed.model_dump()},
        "ack": {**common, "origin_device_id": b, "kind": "ack", "recipient_device_id": a,
                "operation_id": oid, "operation_sha256": hashed},
        "pull": {**common, "origin_device_id": b, "kind": "pull", "recipient_device_id": a,
                 "request_id": "77777777-7777-4777-8777-777777777777", "after": 0}}
    return {"domain_hex": DOMAIN.hex(), "keys": [
        {"device_id": device, "seed_hex": seed.hex(),
         "public_key_b64": encode(Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw())}
        for device, seed in [(a, seed_a), (b, seed_b)]],
        "messages": {name: {"sha256": hashlib.sha256(rfc8785.dumps(body)).hexdigest(),
                            **sign(body, seed_b if name in ("ack", "pull") else seed_a).model_dump()}
                     for name, body in bodies.items()}}


if __name__ == "__main__":
    print(json.dumps(vectors(), indent=2))

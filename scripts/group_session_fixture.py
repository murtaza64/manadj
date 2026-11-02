"""Deterministic FULL Session evidence fixture; public decoy keys, no audio."""
import hashlib
import json

import rfc8785

from backend.peer_sync.group_contracts import sign


def fixture():
    group = "33333333-3333-4333-8333-333333333333"
    origin = "11111111-1111-4111-8111-111111111111"
    events = [
        [{"t": 0, "kind": "load", "channel": "A", "trackId": 7, "bpm": 174},
         {"t": 0.25, "kind": "transport", "channel": "A", "action": "play", "playhead": 0},
         {"t": 5, "kind": "tick", "playheads": {"A": 5}}],
        [{"t": 10, "kind": "load", "channel": "B", "trackId": 9, "bpm": 174},
         {"t": 10.25, "kind": "transport", "channel": "B", "action": "play", "playhead": 0},
         {"t": 20, "kind": "tick", "playheads": {"A": 20, "B": 10}}],
    ]
    manifest = {"session_uuid": "55555555-5555-4555-8555-555555555555", "origin_replica_id": origin,
        "grammar": "capture-events-v1", "reference_basis": "explicit-current-row-bindings",
        "started_at": "2026-01-01T00:00:00Z", "ended_at": "2026-01-01T00:01:00Z", "recording_origin": "Laptop A",
        "tracks": [{"source_local_id": local, "logical_track_id": logical,
                    "asset": {"algorithm": "sha256-file-bytes-v1", "sha256": hashlib.sha256(data).hexdigest(),
                              "byte_length": len(data)}} for local, logical, data in [
            (7, "66666666-6666-4666-8666-666666666666", b"generated-track-a"),
            (9, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b"generated-track-b")]],
        "chunk_sha256": [hashlib.sha256(rfc8785.dumps(chunk)).hexdigest() for chunk in events]}
    operation = {"format": "manadj-device-group/v1", "group_id": group, "origin_device_id": origin,
        "kind": "session-create", "operation_id": "44444444-4444-4444-8444-444444444444", "parents": [],
        "bundle": {"format": "manadj-peer-session", "version": 1, "digest_algorithm": "sha256-rfc8785-jcs-v1",
                   "manifest": manifest, "chunks": [{"seq": seq, "events": chunk} for seq, chunk in enumerate(events)]}}
    signed = sign(operation, bytes(range(32)))
    raw = rfc8785.dumps(operation)
    return {"format": "generated-group-session-fixture/v1", "body_utf8": raw.decode(),
            "signature_b64": signed.signature_b64, "sha256": hashlib.sha256(raw).hexdigest()}


if __name__ == "__main__":
    print(json.dumps(fixture(), indent=2))

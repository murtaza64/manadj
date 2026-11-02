"""NEW signed full Session + deterministic valid WAVs. Public test keys only.

Print the literal fixture with `uv run -m scripts.group_replay_fixture`.
Generate audio locally with `--assets-dir <new empty generated directory>`;
never transfer media through the signed operation or overwrite an existing root.
"""
import argparse
import array
import hashlib
import json
import struct
import sys
from pathlib import Path
from uuid import UUID

import rfc8785

from backend.peer_sync.group_contracts import sign
from backend.peer_sync.replay_contracts import ReplayBinding, ReplayIdentity, replay_generation


def wav_bytes(period_frames, amplitude):
    frames, rate = 96000, 48000
    pcm = array.array("h", (amplitude if n % period_frames < period_frames // 2 else -amplitude for n in range(frames)))
    if sys.byteorder != "little":
        pcm.byteswap()
    data = pcm.tobytes()
    return struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16, 1, 1,
                       rate, rate * 2, 2, 16, b"data", len(data)) + data


def fixture():
    group = "77777777-7777-4777-8777-777777777777"
    origin = "11111111-1111-4111-8111-111111111111"
    sid, oid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    assets = []
    for name, local, logical, period, amplitude in [
        ("tone-a.wav", 7, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", 96, 8192),
        ("tone-b.wav", 9, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", 64, 4096),
    ]:
        data = wav_bytes(period, amplitude)
        assets.append({"file_name": name, "source_local_id": local, "logical_track_id": logical,
            "recipe": {"format": "pcm16le-square/v1", "sample_rate": 48000, "channels": 1,
                       "sample_frames": 96000, "period_frames": period, "amplitude": amplitude},
            "asset": {"algorithm": "sha256-file-bytes-v1", "sha256": hashlib.sha256(data).hexdigest(), "byte_length": len(data)}})
    chunks = [
        [{"t": 0, "kind": "control", "channel": None, "control": "crossfaderEnabled", "value": 0},
         {"t": 0, "kind": "control", "channel": "A", "control": "fader", "value": 1},
         {"t": 0, "kind": "control", "channel": "B", "control": "fader", "value": 1},
         {"t": 0, "kind": "load", "channel": "A", "trackId": 7, "bpm": 120},
         {"t": 0, "kind": "load", "channel": "B", "trackId": 9, "bpm": 120},
         {"t": 0, "kind": "transport", "channel": "A", "action": "play", "playhead": 0},
         {"t": 0.5, "kind": "tick", "playheads": {"A": 0.5, "B": 0}}],
        [{"t": 0.5, "kind": "transport", "channel": "B", "action": "play", "playhead": 0},
         {"t": 1, "kind": "tick", "playheads": {"A": 1, "B": 0.5}},
         {"t": 1.5, "kind": "transport", "channel": "A", "action": "pause", "playhead": 1.5},
         {"t": 1.75, "kind": "transport", "channel": "B", "action": "pause", "playhead": 1.25},
         {"t": 2, "kind": "tick", "playheads": {"A": 1.5, "B": 1.25}}],
    ]
    manifest = {"session_uuid": sid, "origin_replica_id": origin, "grammar": "capture-events-v1",
        "reference_basis": "explicit-current-row-bindings", "started_at": "2026-01-01T00:00:00Z",
        "ended_at": "2026-01-01T00:00:02Z", "recording_origin": "Synthetic Laptop A",
        "tracks": [{key: asset[key] for key in ("source_local_id", "logical_track_id", "asset")} for asset in assets],
        "chunk_sha256": [hashlib.sha256(rfc8785.dumps(events)).hexdigest() for events in chunks]}
    body = {"format": "manadj-device-group/v1", "group_id": group, "origin_device_id": origin,
        "kind": "session-create", "operation_id": oid, "parents": [], "bundle": {"format": "manadj-peer-session", "version": 1,
        "digest_algorithm": "sha256-rfc8785-jcs-v1", "manifest": manifest,
        "chunks": [{"seq": seq, "events": events} for seq, events in enumerate(chunks)]}}
    raw = rfc8785.dumps(body)
    signed = sign(body, bytes(range(32)))
    identity = ReplayIdentity(group_id=UUID(group), operation_id=UUID(oid), operation_sha256=hashlib.sha256(raw).hexdigest(),
        session_uuid=UUID(sid), origin_device_id=UUID(origin), receiver_device_id=UUID("88888888-8888-4888-8888-888888888888"))
    bindings = [ReplayBinding(logical_track_id=UUID(asset["logical_track_id"]), selection_id=UUID(selection),
        receiver_key=key, incarnation=incarnation, asset=asset["asset"]) for asset, selection, key, incarnation in zip(assets,
            ["12121212-1212-4212-8212-121212121212", "13131313-1313-4313-8313-131313131313"], ["73", "88"], ["1" * 64, "2" * 64])]
    return {"format": "generated-group-replay-fixture/v1", "assets": assets, "body_utf8": raw.decode(),
        "signature_b64": signed.signature_b64, "operation_sha256": identity.operation_sha256,
        "generation_vector": {"identity": identity.model_dump(mode="json"), "bindings": [b.model_dump(mode="json") for b in bindings],
                              "generation": replay_generation(identity, bindings)}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets-dir", type=Path)
    args = parser.parse_args()
    result = fixture()
    if args.assets_dir:
        if args.assets_dir.exists() and any(args.assets_dir.iterdir()):
            raise ValueError("New empty generated fixture directory required")
        args.assets_dir.mkdir(parents=True, exist_ok=True)
        for asset in result["assets"]:
            recipe = asset["recipe"]
            (args.assets_dir / asset["file_name"]).write_bytes(wav_bytes(recipe["period_frames"], recipe["amplitude"]))
    print(json.dumps(result, indent=2))

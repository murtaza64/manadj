"""Literal shared replay seam and valid generated audio; no device/media input."""
import hashlib
import io
import json
import wave
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.peer_sync.group_contracts import DOMAIN, Operation, Signed, decode, encode, unpack
from backend.peer_sync.replay_contracts import (
    ReplayBinding,
    ReplayIdentity,
    replay_generation,
    supports_replay_events,
)
from backend.peer_sync.service import validate_complete
from scripts.group_replay_fixture import fixture, wav_bytes


def test_shared_fixture_exact_jcs_signature_full_session_wavs_and_generation():
    value = json.loads((Path(__file__).parent / "fixtures/group_replay_v1.json").read_text())
    assert value == fixture()
    signed = Signed(body_b64=encode(value["body_utf8"].encode()), signature_b64=value["signature_b64"])
    operation, raw, hashed = unpack(signed, Operation)
    assert hashed == value["operation_sha256"]
    Ed25519PrivateKey.from_private_bytes(bytes(range(32))).public_key().verify(decode(signed.signature_b64), DOMAIN + raw)
    assert validate_complete(operation.bundle.manifest, {chunk.seq: chunk.events for chunk in operation.bundle.chunks})
    assert supports_replay_events([event for chunk in operation.bundle.chunks for event in chunk.events])
    for asset in value["assets"]:
        recipe = asset["recipe"]
        data = wav_bytes(recipe["period_frames"], recipe["amplitude"])
        assert len(data) == asset["asset"]["byte_length"] == 192044
        assert hashlib.sha256(data).hexdigest() == asset["asset"]["sha256"]
        with wave.open(io.BytesIO(data), "rb") as audio:
            assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()) == (1, 2, 48000, 96000)
    vector = value["generation_vector"]
    identity = ReplayIdentity.model_validate_json(json.dumps(vector["identity"]))
    bindings = [ReplayBinding.model_validate_json(json.dumps(binding)) for binding in vector["bindings"]]
    assert replay_generation(identity, bindings) == vector["generation"]
    assert replay_generation(identity, list(reversed(bindings))) == vector["generation"]
    assert replay_generation(identity, [bindings[0].model_copy(update={"incarnation": "3" * 64}), bindings[1]]) != vector["generation"]


@pytest.mark.parametrize("event", [
    {"t": 0, "kind": "pitch", "channel": "A", "value": 0},
    {"t": 0, "kind": "control", "channel": "A", "control": "stemVocals", "value": 1},
    {"t": 0, "kind": "transport", "channel": "A", "action": "scratchMove", "playhead": 0},
    {"t": 0, "kind": "transport", "channel": "A", "action": "play", "playhead": 0, "audioTime": 4},
    {"t": 0, "kind": "beatFxSettings", "settings": {"echoFeedback": 0.5}},
])
def test_capture_valid_but_unsupported_replay_evidence_refuses(event):
    assert not supports_replay_events([event])

"""Replica-local exact-asset replay seam v1. Not a transport/trust grant."""
from typing import Literal
from uuid import UUID

from pydantic import Field

from .contracts import Asset, Digest, Strict, digest
from .events import validate_events

REPLAY_GRAMMAR = "capture-group-basic-replay/v1"


class ReceiverSelection(Strict):
    format: Literal["manadj-group-receiver-selection/v1"]
    selection_id: UUID
    receiver_key: str = Field(min_length=1, max_length=128)
    incarnation: Digest
    label: str = Field(min_length=1, max_length=160)
    asset: Asset


class ReplayIdentity(Strict):
    group_id: UUID
    operation_id: UUID
    operation_sha256: Digest
    session_uuid: UUID
    origin_device_id: UUID
    receiver_device_id: UUID


class ReplayBinding(Strict):
    logical_track_id: UUID
    selection_id: UUID
    receiver_key: str = Field(min_length=1, max_length=128)
    incarnation: Digest
    asset: Asset


class ReplayReadiness(Strict):
    format: Literal["manadj-group-replay-readiness/v1"]
    identity: ReplayIdentity
    grammar: Literal["capture-group-basic-replay/v1"]
    state: Literal["projection-pending", "unbound", "missing", "partial", "changed", "stale-selection", "unverified",
                   "unsupported-identity", "unsupported-grammar", "revoked", "conflicted", "invalid",
                   "error", "candidate-exact"]
    generation: Digest | None
    bindings: list[ReplayBinding] = Field(max_length=128)
    reason: str | None = Field(default=None, max_length=160)
    # Exact bytes are only a candidate. Actual engine decode/load proof is
    # required before play, and is never accepted from a persisted JSON view.
    playable: Literal[False]


class BindReplayTrack(Strict):
    logical_track_id: UUID
    selection_id: UUID
    incarnation: Digest


def replay_generation(identity: ReplayIdentity, bindings: list[ReplayBinding]):
    return digest({"format": "manadj-group-replay-generation/v1", "identity": identity.model_dump(mode="json"),
                   "grammar": REPLAY_GRAMMAR,
                   "bindings": [binding.model_dump(mode="json") for binding in sorted(bindings, key=lambda b: str(b.logical_track_id))]})


def supports_replay_events(events):
    try:
        validate_events(events)
    except (ValueError, TypeError, KeyError):
        return False
    fields = {"load": {"t", "kind", "channel", "trackId", "bpm"},
              "tick": {"t", "kind", "playheads"},
              "transport": {"t", "kind", "channel", "action", "playhead"},
              "control": {"t", "kind", "channel", "control", "value"}}
    return bool(events) and all(event["kind"] in fields and set(event) <= fields[event["kind"]]
        and (event["kind"] != "transport" or event["action"] in {"play", "pause", "seek", "cue"})
        and (event["kind"] != "control" or event["control"] in {"fader", "crossfader", "crossfaderEnabled"}) for event in events)

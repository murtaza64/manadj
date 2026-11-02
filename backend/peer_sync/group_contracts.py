"""Device-group v1: signed opaque bytes; never import authority from the wire."""
import base64
import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID

import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import Field

from ..peer_inventory.contracts import Strict
from .contracts import Bundle, Digest

DOMAIN = b"manadj-device-group/v1\x00"
MAX_BYTES = 4 * 1024 * 1024
Counter = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
UUID_FIELDS = frozenset({"group_id", "origin_device_id", "recipient_device_id", "operation_id",
                         "request_id", "session_uuid", "origin_replica_id", "logical_track_id"})


class Signed(Strict):
    body_b64: str = Field(min_length=4, max_length=(MAX_BYTES + 2) // 3 * 4)
    signature_b64: str = Field(min_length=88, max_length=88)


class Header(Strict):
    format: Literal["manadj-device-group/v1"]
    group_id: UUID
    origin_device_id: UUID


class Operation(Header):
    kind: Literal["session-create"]
    operation_id: UUID
    parents: list[Digest] = Field(max_length=0)
    bundle: Bundle


class Delivery(Header):
    kind: Literal["deliver"]
    recipient_device_id: UUID
    operation: Signed


class Ack(Header):
    kind: Literal["ack"]
    recipient_device_id: UUID
    operation_id: UUID
    operation_sha256: Digest


class Pull(Header):
    kind: Literal["pull"]
    recipient_device_id: UUID
    request_id: UUID
    after: Counter


class Page(Header):
    kind: Literal["page"]
    recipient_device_id: UUID
    request_id: UUID
    next_after: Counter
    more: bool
    operations: list[Signed] = Field(max_length=1)


def encode(raw):
    return base64.b64encode(raw).decode("ascii")


def decode(value):
    raw = base64.b64decode(value, validate=True)
    if encode(raw) != value:
        raise ValueError("Noncanonical base64")
    return raw


def sign(body, private_key):
    raw = rfc8785.dumps(body)
    if len(raw) > MAX_BYTES:
        raise ValueError("Group message too large")
    key = Ed25519PrivateKey.from_private_bytes(private_key)
    return Signed(body_b64=encode(raw), signature_b64=encode(key.sign(DOMAIN + raw)))


def wire_identifiers(value):
    """Validate raw wire spelling before Pydantic can normalize a UUID.

    Includes nested Bundle identifiers without changing legacy Bundle parsing.
    Signed inner operations are checked when their own opaque bytes unpack.
    """
    if isinstance(value, dict):
        for field, child in value.items():
            if field in UUID_FIELDS and (not isinstance(child, str) or str(UUID(child)) != child):
                raise ValueError("Canonical lowercase hyphenated wire UUID required")
            wire_identifiers(child)
    elif isinstance(value, list):
        for child in value:
            wire_identifiers(child)


def unpack(signed, model):
    """Authenticate these exact bytes later; parsing never supplies trusted keys."""
    raw = decode(signed.body_b64)
    if len(raw) > MAX_BYTES:
        raise ValueError("Group message too large")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    body = json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    wire_identifiers(body)
    if rfc8785.dumps(body) != raw:
        raise ValueError("Canonical issuer JSON required")
    return model.model_validate_json(raw), raw, hashlib.sha256(raw).hexdigest()

import hashlib
import re
from datetime import datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, JsonValue, field_validator, model_validator
import rfc8785

from ..peer_inventory.contracts import LocalId, Strict
from .events import reference_ids, validate_events

Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


def digest(value):
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


class SourceBody(Strict):
    replica_id: UUID
    label: str = Field(min_length=1, max_length=80)


class GuardBody(Strict):
    guard: Digest


class BindBody(GuardBody):
    logical_track_id: UUID


class ExportBody(Strict):
    reference_basis: Literal["explicit-current-row-bindings"]
    seqs: list[Annotated[int, Field(ge=0, le=4095)]] | None = Field(default=None, max_length=4096)
    fingerprint_assets: bool = False


class Asset(Strict):
    algorithm: Literal["sha256-file-bytes-v1"]
    sha256: Digest
    byte_length: int = Field(ge=1, le=512 * 1024 * 1024)


class TrackReference(Strict):
    source_local_id: LocalId
    logical_track_id: UUID
    asset: Asset | None


class Manifest(Strict):
    session_uuid: UUID
    origin_replica_id: UUID
    grammar: Literal["capture-events-v1"]
    reference_basis: Literal["explicit-current-row-bindings"]
    started_at: datetime
    ended_at: datetime
    recording_origin: str | None = Field(max_length=128)
    tracks: list[TrackReference] = Field(max_length=128)
    chunk_sha256: list[Digest] = Field(min_length=1, max_length=4096)

    @field_validator("started_at", "ended_at", mode="before")
    @classmethod
    def timestamp(cls, value):
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})", value
        ):
            raise ValueError("RFC3339 strings required")
        return datetime.fromisoformat(value.replace("t", "T").replace("z", "Z"))

    @model_validator(mode="after")
    def bounds(self):
        if self.started_at.utcoffset() != timedelta(0) or self.ended_at.utcoffset() != timedelta(0) or self.ended_at < self.started_at:
            raise ValueError("Closed UTC Session required")
        if len({ref.source_local_id for ref in self.tracks}) != len(self.tracks) or len({ref.logical_track_id for ref in self.tracks}) != len(self.tracks):
            raise ValueError("Unique explicit Track references required")
        return self


class Chunk(Strict):
    seq: int = Field(ge=0, le=4095)
    events: list[dict[str, JsonValue]] = Field(min_length=1, max_length=5000)

    @field_validator("events")
    @classmethod
    def event_grammar(cls, events):
        return validate_events(events)


class Bundle(Strict):
    format: Literal["manadj-peer-session"]
    version: Literal[1]
    digest_algorithm: Literal["sha256-rfc8785-jcs-v1"]
    manifest: Manifest
    chunks: list[Chunk] = Field(min_length=1, max_length=4096)

    @field_validator("version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("Integer version required")
        return value

    @model_validator(mode="after")
    def consistent(self):
        if len({chunk.seq for chunk in self.chunks}) != len(self.chunks):
            raise ValueError("Duplicate chunk sequence")
        declared = {ref.source_local_id for ref in self.manifest.tracks}
        for chunk in self.chunks:
            if chunk.seq >= len(self.manifest.chunk_sha256) or digest(chunk.events) != self.manifest.chunk_sha256[chunk.seq]:
                raise ValueError("Chunk digest mismatch")
            if not reference_ids(chunk.events) <= declared:
                raise ValueError("Undeclared source Track reference")
        return self

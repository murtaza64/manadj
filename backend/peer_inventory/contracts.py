"""Portable snapshot facts and explicit caller-supplied identity claims, never grants."""
import hashlib
import json
from pathlib import PurePosixPath, PureWindowsPath
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_TRACKS = 5000
MAX_WIRE = 4 * 1024 * 1024
MAX_EXPORT = 3 * 1024 * 1024
LocalId = Annotated[int, Field(ge=1, le=9007199254740991)]
RootKey = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
IdKey = Annotated[str, Field(pattern=r"^[1-9][0-9]{0,15}$")]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


class Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)


class Root(Strict):
    key: RootKey
    flavor: Literal["posix", "windows"]
    path: str = Field(min_length=1, max_length=4096)

    def pure(self, value):
        return (PurePosixPath if self.flavor == "posix" else PureWindowsPath)(value)

    @model_validator(mode="after")
    def absolute(self):
        path = self.pure(self.path)
        if not path.is_absolute() or ".." in path.parts or "\x00" in self.path:
            raise ValueError("Explicit absolute root without traversal required")
        return self


class ExportRequest(Strict):
    replica_id: UUID
    roots: list[Root] = Field(max_length=16)
    logical_ids: dict[IdKey, UUID] = Field(default_factory=dict, max_length=MAX_TRACKS)

    @model_validator(mode="after")
    def unique_roots(self):
        if len({root.key for root in self.roots}) != len(self.roots):
            raise ValueError("Duplicate root key")
        return self


class Location(Strict):
    root_key: RootKey
    parts: list[Annotated[str, Field(min_length=1, max_length=255)]] = Field(min_length=1, max_length=64)

    @field_validator("parts")
    @classmethod
    def portable_parts(cls, parts):
        if any(part in {".", ".."} or any(c in part for c in "/\\:\x00") for part in parts):
            raise ValueError("Portable relative path segments required")
        return parts


class Facts(Strict):
    title: str | None = Field(max_length=2048)
    artist: str | None = Field(max_length=2048)
    bpm_centibpm_cache: int | None
    key: int | None
    energy: int | None
    duration_secs: float | None
    filesize_bytes: int | None
    archived: bool


class TrackRow(Strict):
    source_local_id: LocalId
    logical_track_id: UUID | None
    source_created_at: str | None = Field(max_length=64)
    location: Location | None
    legacy_hash_hint: str | None = Field(max_length=256)
    availability: Literal["not_checked"]
    facts: Facts
    snapshot_token: str = Field(pattern=r"^[0-9a-f]{64}$")

    @staticmethod
    def token(fields):
        return hashlib.sha256(canonical(fields)).hexdigest()

    @model_validator(mode="after")
    def consistent_snapshot(self):
        # Integrity of public snapshot facts only, not authentication or identity.
        fields = self.model_dump(mode="json", exclude={"snapshot_token"})
        if self.snapshot_token != self.token(fields):
            raise ValueError("Inconsistent snapshot token")
        return self


class Inventory(Strict):
    format: Literal["manadj-peer-inventory"]
    version: Literal[1]
    replica_id: UUID
    tracks: list[TrackRow] = Field(max_length=MAX_TRACKS)

    @field_validator("version", mode="before")
    @classmethod
    def integer_version(cls, version):
        if type(version) is not int:
            raise ValueError("Integer version required")
        return version

    @model_validator(mode="after")
    def unique_references(self):
        if len({row.source_local_id for row in self.tracks}) != len(self.tracks):
            raise ValueError("Duplicate source-local reference")
        return self


class CompareRequest(Strict):
    local: ExportRequest
    remote: Inventory

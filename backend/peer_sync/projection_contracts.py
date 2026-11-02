"""Replica-local projection view v1; not a new transport or authority document."""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from .contracts import Asset, Digest, Strict


class ProjectionDevice(Strict):
    device_id: UUID
    label: str = Field(min_length=1, max_length=80)
    revoked: bool


class ProjectionRetry(Strict):
    group_id: UUID
    operation_id: UUID


class ProjectionTrack(Strict):
    logical_track_id: UUID
    asset_state: Literal["unbound", "missing", "partial", "changed", "unverified", "exact"]
    expected_asset: Asset | None


class GroupSessionView(Strict):
    format: Literal["manadj-group-session-view/v1"]
    group_id: UUID
    operation_id: UUID
    session_uuid: UUID
    operation_sha256: Digest
    manifest_sha256: Digest
    origin: ProjectionDevice
    relays: list[ProjectionDevice]
    started_at: datetime
    ended_at: datetime
    status: Literal["projection-pending", "unbound", "missing-assets", "changed-assets", "unverified-assets",
                    "metadata-ready", "conflicted", "revoked", "invalid"]
    projected: bool
    playable: Literal[False]
    editable: Literal[False]
    conflict_count: int = Field(ge=0)
    tracks: list[ProjectionTrack] = Field(max_length=128)

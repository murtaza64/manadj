"""Pydantic models for the track_metadata module."""

from pydantic import BaseModel, field_validator


class TrackChanges(BaseModel):
    """A set of changes to apply to a Track. None means "leave unchanged".

    bpm is float BPM (centiBPM never crosses this interface); key is an
    Engine DJ key ID (0-23).
    """

    title: str | None = None
    artist: str | None = None
    key: int | None = None
    bpm: float | None = None
    energy: int | None = None
    tag_ids: list[int] | None = None

    @field_validator("key")
    @classmethod
    def key_in_range(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 23:
            raise ValueError(f"key must be an Engine DJ key ID (0-23), got {v}")
        return v

    @field_validator("energy")
    @classmethod
    def energy_in_range(cls, v: int | None) -> int | None:
        if v is not None and not 1 <= v <= 5:
            raise ValueError(f"energy must be 1-5, got {v}")
        return v


class MetadataValues(BaseModel):
    """Metadata values for comparison. bpm: float BPM; key: musical notation."""

    title: str | None = None
    artist: str | None = None
    bpm: float | None = None
    key: str | None = None


class MetadataComparison(BaseModel):
    """Comparison of database vs file metadata for a single track."""

    track_id: int
    filename: str
    current: MetadataValues  # from DB
    file: MetadataValues  # from file tags
    differences: list[str]  # subset of ["title", "artist", "bpm", "key"]
    conflict_type: str  # "only_in_file" | "only_in_db" | "conflict" | "match"


class MetadataComparisonStats(BaseModel):
    total_tracks: int
    tracks_with_changes: int
    tracks_with_conflicts: int
    missing_files: int


class MetadataComparisonResult(BaseModel):
    stats: MetadataComparisonStats
    comparisons: list[MetadataComparison]


class TrackMetadataUpdate(BaseModel):
    """Update request for a single track. Field values use the comparison's
    units: bpm float BPM, key musical notation."""

    track_id: int
    fields: dict[str, str | float | None]


class MetadataSyncRequest(BaseModel):
    updates: list[TrackMetadataUpdate]
    dry_run: bool = True


class MetadataSyncStats(BaseModel):
    total_requested: int
    updated: int
    skipped: int
    errors: int
    error_messages: list[str] = []


class MetadataSyncResult(BaseModel):
    stats: MetadataSyncStats
    dry_run: bool

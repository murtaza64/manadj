"""Data model for the unified sync view (see .scratch/unified-sync-view/PRD.md).

Field value conventions at this interface:
- key: canonical Engine DJ key ID (int) — notation differences are the
  adapter's job to normalize, so they can never appear as divergences
- bpm: float BPM (centiBPM never crosses this interface)
- tags: Tag assignment names; None means the surface doesn't carry tags
"""

from dataclasses import dataclass, field
from typing import Literal

SurfaceId = Literal["disk", "engine", "rekordbox"]
SURFACE_IDS: tuple[SurfaceId, ...] = ("disk", "engine", "rekordbox")
EXTERNAL_LIBRARY_IDS: tuple[SurfaceId, ...] = ("engine", "rekordbox")
FieldName = Literal[
    "title", "artist", "key", "bpm", "energy", "tags", "hotcues", "beatgrid", "maincue"
]
RowStatus = Literal[
    "missing-downstream", "diverged", "not-in-library", "unimported", "in-sync"
]

SCALAR_FIELDS: tuple[FieldName, ...] = ("title", "artist", "key", "bpm", "energy")


@dataclass(frozen=True)
class TempoChangeValue:
    """One tempo change of a Beatgrid as compared across Surfaces."""

    start_time: float  # seconds
    bpm: float
    bar_position: int = 1


@dataclass(frozen=True)
class BeatgridValue:
    """A Beatgrid as compared across Surfaces. A placeholder grid (origin
    "generated") never crosses this interface — it reads as absent (None)."""

    tempo_changes: list[TempoChangeValue]


@dataclass(frozen=True)
class HotCueValue:
    """One Hot Cue as compared across Surfaces. Times are seconds; labels
    are normalized (empty string never crosses this interface — None does);
    colors are uppercase #RRGGBB or None."""

    slot: int  # 1-8
    time: float
    label: str | None = None
    color: str | None = None


@dataclass(frozen=True)
class TrackFields:
    """Field values a Surface holds for one track."""

    title: str | None = None
    artist: str | None = None
    key: int | None = None
    bpm: float | None = None
    energy: int | None = None
    tags: list[str] | None = None
    # None = this surface doesn't carry hot cues for this track (no blob /
    # unparseable); [] = it does, and there are none.
    hotcues: list[HotCueValue] | None = None
    # None = no grid here (missing, unparseable, or a placeholder)
    beatgrid: BeatgridValue | None = None
    # None = no user-set Main cue here (manadj: unset; Engine: not overridden)
    maincue: float | None = None


@dataclass(frozen=True)
class SurfaceTrackRef:
    """One track as a Surface sees it."""

    path: str | None
    fields: TrackFields


@dataclass
class FieldDivergence:
    """One field disagreeing between the Library and one or more Surfaces."""

    field: str
    library_value: object
    surface_values: dict[str, object]  # only surfaces that DISAGREE
    importable_from: list[str]
    no_overwrite: bool  # Library value is empty; Export must skip + warn


@dataclass
class SyncStatusRow:
    path: str
    title: str | None
    artist: str | None
    track_id: int | None  # None when not in the Library
    presence: dict[str, bool]  # disk / library / engine / rekordbox
    status: RowStatus
    unprocessed: bool
    # Archived (CONTEXT.md): still Matched (so downstream copies aren't
    # misread as external-only) but never attention-worthy.
    archived: bool = False
    diverged: list[FieldDivergence] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class SyncStatusResult:
    rows: list[SyncStatusRow]
    counts: dict[str, int]

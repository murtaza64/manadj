"""Data models for Rekordbox data."""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class RekordboxTrack:
    """Rekordbox track with MyTag data."""
    title: str
    artist: str
    file_path: Path | None
    bpm: float | None
    key: str | None
    mytags: tuple[tuple[str, str], ...] = field(default_factory=tuple)  # ((category, tag), ...)
    color_id: str | None = None  # Rekordbox color ID (0-8 as string)


@dataclass
class MyTagStructure:
    """MyTag hierarchy structure."""
    categories: dict[str, list[str]]  # {category: [tag1, tag2, ...]}

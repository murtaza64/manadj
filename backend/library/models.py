"""Data models for library import operations."""

from pydantic import BaseModel


class LibraryTrackCandidate(BaseModel):
    """A track candidate for import."""
    filepath: str
    filename: str
    title: str | None = None
    artist: str | None = None
    bpm: float | None = None
    # Engine DJ key ID (0-23), as read_file_metadata returns and Track.key
    # stores. Was mistyped `str` — the scan crashed on the first key-tagged
    # file it ever met (a Soulseek FLAC/MP3 rip; SoundCloud audio is untagged).
    key: int | None = None
    has_metadata: bool = False


class LibraryImportStats(BaseModel):
    """Statistics for library import operation."""
    files_scanned: int = 0
    already_in_db: int = 0
    new_tracks: int = 0
    with_metadata: int = 0
    without_metadata: int = 0


class LibraryImportResult(BaseModel):
    """Result of scanning library for import candidates."""
    candidates: list[LibraryTrackCandidate]
    stats: LibraryImportStats


class LibraryImportRequest(BaseModel):
    """Request to import tracks."""
    candidate_filepaths: list[str] | None = None  # None = import all


class LibraryImportExecutionResult(BaseModel):
    """Result of executing library import."""
    imported: int = 0
    skipped_no_metadata: int = 0
    errors: int = 0
    error_messages: list[str] = []

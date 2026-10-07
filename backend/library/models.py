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
    # Scan subfolders (onboarding #276): must match the candidates scan, or
    # files found in subfolders are silently dropped on import.
    recursive: bool = True


class LibraryImportExecutionResult(BaseModel):
    """Result of executing library import."""
    imported: int = 0
    skipped_no_metadata: int = 0
    errors: int = 0
    error_messages: list[str] = []
    track_ids: list[int] = []


class DropImportRequest(BaseModel):
    """Files/folders dropped from the filesystem (absolute paths)."""
    paths: list[str]
    playlist_id: int | None = None


class DropImportResult(BaseModel):
    """Outcome of a drop Disk Import (files imported in place)."""
    imported: int = 0
    skipped: int = 0  # already in the Library (path match, archived included)
    failed: int = 0
    ignored: int = 0  # non-audio files
    error_messages: list[str] = []
    track_ids: list[int] = []
    playlist_added: int = 0

"""Manager class for library track import operations."""

import re
from collections.abc import Callable
from pathlib import Path
from sqlalchemy.orm import Session
from ..models import Track
from ..sync_common.matching import path_key
from ..track_metadata import FileMetadataError, read_file_metadata
from ..track_metadata.units import bpm_to_centibpm
from .models import (
    LibraryTrackCandidate, LibraryImportStats,
    LibraryImportResult, LibraryImportExecutionResult
)
from .scanner import scan_directory


def parse_filename_metadata(filename: str) -> dict[str, str | None]:
    """
    Extract artist and title from filename using heuristics.

    Heuristic:
    1. Strip anything in square brackets
    2. Remove file extension
    3. If hyphen exists: artist = before hyphen, title = after hyphen
    4. If no hyphen: title = whole filename, artist = None

    Args:
        filename: The filename (with or without path)

    Returns:
        Dictionary with 'artist' and 'title' keys
    """
    # Get just the filename without path
    name = Path(filename).stem

    # Strip square bracketed content
    name = re.sub(r'\[.*?\]', '', name)

    # Strip extra whitespace
    name = name.strip()

    # Look for hyphen separator
    if ' - ' in name:
        parts = name.split(' - ', 1)
        return {
            'artist': parts[0].strip(),
            'title': parts[1].strip()
        }
    else:
        return {
            'artist': None,
            'title': name
        }



def build_candidate(file_path: Path) -> LibraryTrackCandidate:
    """Read tags (falling back to filename heuristics) into a candidate."""
    file_path_str = str(file_path)
    # Extract metadata from file tags (unreadable file -> no metadata)
    try:
        metadata = read_file_metadata(file_path_str)
    except FileMetadataError:
        metadata = None

    title = metadata.title if metadata else None
    artist = metadata.artist if metadata else None

    # Fallback to filename parsing if no title in metadata
    if not title:
        filename_metadata = parse_filename_metadata(file_path.name)
        title = filename_metadata['title']
        # Only use filename artist if ID3 artist is also missing
        if not artist:
            artist = filename_metadata['artist']

    return LibraryTrackCandidate(
        filepath=file_path_str,
        filename=file_path.name,
        title=title,
        artist=artist,
        bpm=metadata.bpm if metadata else None,
        key=metadata.key if metadata else None,
        # Track has metadata if it has at least a title (from any source)
        has_metadata=bool(title),
    )


class LibraryImportManager:
    """Manages library track import operations."""

    def __init__(self, manadj_session: Session, library_path: str):
        """
        Initialize manager.

        Args:
            manadj_session: SQLAlchemy session for manadj database
            library_path: Path to library directory
        """
        self.manadj_session = manadj_session
        self.library_path = Path(library_path)

    def existing_paths(self) -> set[str]:
        """``path_key``s of every Track's resolved path, archived included
        (never re-proposed). Test membership with ``path_key(str(path))``."""
        rows = self.manadj_session.query(Track.filename).all()
        return {path_key(str(Path(t.filename).resolve())) for t in rows}

    def get_import_candidates(
        self,
        recursive: bool = False,
        progress: Callable[[int, int], None] | None = None,
    ) -> LibraryImportResult:
        """
        Get list of tracks that can be imported.

        Args:
            recursive: Whether to scan subdirectories
            progress: optional (files done, files total) callback — tag
                reading is the slow part of a large first scan

        Returns:
            LibraryImportResult with candidates and stats
        """
        stats = LibraryImportStats()

        # Scan directory
        audio_files = scan_directory(self.library_path, recursive)
        stats.files_scanned = len(audio_files)

        existing_filenames = self.existing_paths()

        # Find new tracks and extract metadata
        candidates = []
        total = len(audio_files)
        for i, file_path in enumerate(audio_files, start=1):
            if progress is not None and (i % 25 == 0 or i == total):
                progress(i, total)
            # Skip if already in database
            if path_key(str(file_path)) in existing_filenames:
                stats.already_in_db += 1
                continue

            stats.new_tracks += 1
            candidate = build_candidate(file_path)
            if candidate.has_metadata:
                stats.with_metadata += 1
            else:
                stats.without_metadata += 1
            candidates.append(candidate)

        return LibraryImportResult(candidates=candidates, stats=stats)

    def import_tracks(
        self,
        candidates: list[LibraryTrackCandidate] | None = None,
        derive_provenance: bool = True,
        stem_guard: int | None = None,
    ) -> LibraryImportExecutionResult:
        """
        Import tracks into database.

        Args:
            candidates: Specific candidates to import (None = reimport all)
            derive_provenance: derive asserted Audio Provenance from file
                hints (backfill rules). The acquisition download path opts
                out — it records provenance itself.
            stem_guard: when set, a batch of more than this many new
                Tracks enqueues no stem splits (bulk drops; the startup
                sweep's backlog guard). None = always enqueue.

        Returns:
            LibraryImportExecutionResult with import statistics
        """
        result = LibraryImportExecutionResult()
        imported_tracks = []

        # If no candidates provided, get fresh list
        if candidates is None:
            import_result = self.get_import_candidates()
            candidates = import_result.candidates

        for candidate in candidates:
            try:
                bpm_centi = bpm_to_centibpm(candidate.bpm)

                # Create track record (use filename as fallback for title if somehow missing)
                track = Track(
                    filename=candidate.filepath,
                    title=candidate.title or candidate.filename,
                    artist=candidate.artist,
                    bpm=bpm_centi,
                    key=candidate.key,
                    energy=None,
                    file_hash=None
                )

                self.manadj_session.add(track)
                imported_tracks.append(track)
                result.imported += 1

            except Exception as e:
                result.errors += 1
                result.error_messages.append(f"{candidate.filename}: {str(e)}")

        # Commit all changes
        if result.imported > 0:
            try:
                self.manadj_session.commit()
                # fill file-derived fields (codec/bitrate/filesize/duration)
                from ..track_metadata.file_facts import refresh_file_facts
                refresh_file_facts(self.manadj_session)
                # Imported Tracks get Waveform data via the task system.
                from ..waveform_tasks import enqueue_missing_waveforms
                enqueue_missing_waveforms(self.manadj_session)
                # ... and native grid+key Analysis (ADR 0024).
                from ..analysis_tasks import enqueue_missing_analysis
                enqueue_missing_analysis(self.manadj_session)
                result.track_ids = [t.id for t in imported_tracks]
                # Queue only this import, never the guarded full-library sweep.
                from ..stems_tasks import enqueue_stem_split
                if stem_guard is None or len(imported_tracks) <= stem_guard:
                    for track in imported_tracks:
                        enqueue_stem_split(self.manadj_session, track.id)
                if derive_provenance:
                    from ..acquisition.provenance import derive_and_write_provenance
                    imported_paths = [c.filepath for c in candidates]
                    tracks = (
                        self.manadj_session.query(Track)
                        .filter(Track.filename.in_(imported_paths))
                        .all()
                    )
                    derive_and_write_provenance(self.manadj_session, tracks)
                    self.manadj_session.commit()
            except Exception as e:
                self.manadj_session.rollback()
                result.error_messages.append(f"Commit failed: {str(e)}")
                result.errors += result.imported
                result.imported = 0
                result.track_ids = []

        return result

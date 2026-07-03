"""Manager class for library track import operations."""

import re
from pathlib import Path
from sqlalchemy.orm import Session
from ..models import Track
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

    def get_import_candidates(self, recursive: bool = False) -> LibraryImportResult:
        """
        Get list of tracks that can be imported.

        Args:
            recursive: Whether to scan subdirectories

        Returns:
            LibraryImportResult with candidates and stats
        """
        stats = LibraryImportStats()

        # Scan directory
        audio_files = scan_directory(self.library_path, recursive)
        stats.files_scanned = len(audio_files)

        # Get existing tracks from database
        existing_tracks = self.manadj_session.query(Track.filename).all()
        existing_filenames = {str(Path(t.filename).resolve()) for t in existing_tracks}

        # Find new tracks and extract metadata
        candidates = []
        for file_path in audio_files:
            file_path_str = str(file_path)

            # Skip if already in database
            if file_path_str in existing_filenames:
                stats.already_in_db += 1
                continue

            stats.new_tracks += 1

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

            # Track has metadata if it has at least a title (from any source)
            has_metadata = bool(title)

            if has_metadata:
                stats.with_metadata += 1
            else:
                stats.without_metadata += 1

            candidate = LibraryTrackCandidate(
                filepath=file_path_str,
                filename=file_path.name,
                title=title,
                artist=artist,
                bpm=metadata.bpm if metadata else None,
                key=metadata.key if metadata else None,
                has_metadata=has_metadata
            )
            candidates.append(candidate)

        return LibraryImportResult(candidates=candidates, stats=stats)

    def import_tracks(
        self,
        candidates: list[LibraryTrackCandidate] | None = None,
        derive_provenance: bool = True,
    ) -> LibraryImportExecutionResult:
        """
        Import tracks into database.

        Args:
            candidates: Specific candidates to import (None = reimport all)
            derive_provenance: derive asserted Audio Provenance from file
                hints (backfill rules). The acquisition download path opts
                out — it records provenance itself.

        Returns:
            LibraryImportExecutionResult with import statistics
        """
        result = LibraryImportExecutionResult()

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

        return result

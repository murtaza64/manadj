"""Playlist sync manager - orchestration class."""

from sqlalchemy.orm import Session
from pathlib import Path

from .models import PlaylistInfo, UnifiedPlaylist, PlaylistSyncStats, TrackEntry, SyncResult, TrackReference
from .comparison import are_playlists_equivalent
from .matching import match_playlists_by_name
from .manadj_reader import ManAdjPlaylistReader
from backend.sync_common.matching import index_tracks_by_path, match_track_two_tier


class PlaylistSyncManager:
    """Orchestrates playlist loading, matching, and comparison.

    Handles optional Engine DJ and Rekordbox databases with graceful degradation.
    """

    def __init__(self, manadj_session: Session, engine_db=None, rb_db=None):
        """Initialize with database connections.

        Args:
            manadj_session: Required manadj SQLAlchemy session
            engine_db: Optional EngineDJDatabase instance
            rb_db: Optional Rekordbox6Database instance
        """
        # Store database connections for write operations
        self.manadj_session = manadj_session
        self.engine_db = engine_db
        self.rb_db = rb_db

        # Always create manadj reader
        self.manadj_reader = ManAdjPlaylistReader(manadj_session)

        # Conditionally create Engine DJ reader
        self.engine_reader = None
        if engine_db:
            from enginedj.playlist_reader import EnginePlaylistReader
            self.engine_reader = EnginePlaylistReader(engine_db)

        # Conditionally create Rekordbox reader
        self.rb_reader = None
        if rb_db:
            from rekordbox.playlist_reader import RekordboxPlaylistReader
            self.rb_reader = RekordboxPlaylistReader(rb_db)

    def load_all_playlists(self) -> dict[str, list[PlaylistInfo]]:
        """Load playlists from all available sources.

        Returns:
            Dictionary with keys 'manadj', 'engine', 'rekordbox' and
            lists of PlaylistInfo as values
        """
        result = {'manadj': [], 'engine': [], 'rekordbox': []}

        # Always load manadj
        result['manadj'] = self.manadj_reader.get_all_playlists()

        # Load Engine DJ if available
        if self.engine_reader:
            result['engine'] = self.engine_reader.get_all_playlists()

        # Load Rekordbox if available
        if self.rb_reader:
            result['rekordbox'] = self.rb_reader.get_all_playlists()

        return result

    def get_unified_view(self) -> list[UnifiedPlaylist]:
        """Get unified view of all playlists for API response.

        Returns:
            List of UnifiedPlaylist objects for UI display
        """
        # Load all playlists
        all_playlists = self.load_all_playlists()

        # Match by name
        matched = match_playlists_by_name(all_playlists)

        # Convert to UnifiedPlaylist objects
        result = []
        for name, sources in matched.items():
            # Extract filenames AND track IDs from each source
            manadj_tracks = None
            if sources['manadj']:
                manadj_tracks = [
                    TrackEntry(filename=t.filename, track_id=t.track_id)
                    for t in sources['manadj'].tracks
                ]

            engine_tracks = None
            if sources['engine']:
                engine_tracks = [
                    TrackEntry(filename=t.filename, track_id=t.track_id)
                    for t in sources['engine'].tracks
                ]

            rekordbox_tracks = None
            if sources['rekordbox']:
                rekordbox_tracks = [
                    TrackEntry(filename=t.filename, track_id=t.track_id)
                    for t in sources['rekordbox'].tracks
                ]

            # Check if synced
            synced = self._check_if_synced(sources)

            unified = UnifiedPlaylist(
                name=name,
                manadj=manadj_tracks,
                engine=engine_tracks,
                rekordbox=rekordbox_tracks,
                synced=synced
            )
            result.append(unified)

        return result

    def _check_if_synced(self, sources: dict[str, PlaylistInfo | None]) -> bool:
        """Check if all non-None sources have identical tracks.

        Args:
            sources: Dictionary with 'manadj', 'engine', 'rekordbox' keys

        Returns:
            True if all non-None playlists have the same tracks in same order
        """
        # Get non-None playlists
        playlists = [p for p in sources.values() if p is not None]

        if len(playlists) <= 1:
            return True  # Nothing to compare or only one source

        # Compare all playlists against the first one
        base = playlists[0]
        for playlist in playlists[1:]:
            if not are_playlists_equivalent(base, playlist):
                return False

        return True

    def get_stats(self) -> PlaylistSyncStats:
        """Get loading statistics.

        Returns:
            PlaylistSyncStats with counts of playlists per source
        """
        # Load all playlists
        all_playlists = self.load_all_playlists()

        # Match by name
        matched = match_playlists_by_name(all_playlists)

        # Calculate stats
        stats = PlaylistSyncStats()
        stats.manadj_playlists_loaded = len(all_playlists['manadj'])
        stats.engine_playlists_loaded = len(all_playlists['engine'])
        stats.rekordbox_playlists_loaded = len(all_playlists['rekordbox'])
        stats.playlists_matched = len(matched)

        # Count unique playlists per source (exists in only one source)
        for name, sources in matched.items():
            has_manadj = sources['manadj'] is not None
            has_engine = sources['engine'] is not None
            has_rekordbox = sources['rekordbox'] is not None

            # Count playlists that exist in only one source
            if has_manadj and not has_engine and not has_rekordbox:
                stats.playlists_unique_manadj += 1
            elif has_engine and not has_manadj and not has_rekordbox:
                stats.playlists_unique_engine += 1
            elif has_rekordbox and not has_manadj and not has_engine:
                stats.playlists_unique_rekordbox += 1

        return stats

    # ========================================================================
    # Write Operations (Playlist Sync)
    # ========================================================================

    def sync_playlist_to_target(
        self,
        playlist_name: str,
        source: str,
        target: str,
        ignore_missing_tracks: bool = False,
        dry_run: bool = False
    ) -> SyncResult:
        """Sync playlist from source to target.

        Args:
            playlist_name: Name of playlist to sync
            source: Source database ('manadj', 'engine', or 'rekordbox')
            target: Target database ('manadj', 'engine', or 'rekordbox')
            ignore_missing_tracks: If True, proceed even if some tracks can't be matched
            dry_run: If True, return result without committing changes

        Returns:
            SyncResult with success status and details
        """
        # Validate source and target
        if source not in ('manadj', 'engine', 'rekordbox'):
            return SyncResult(
                target=target,
                success=False,
                created=False,
                tracks_synced=0,
                tracks_unmatched=[],
                error=f"Invalid source: {source}"
            )

        if target not in ('manadj', 'engine', 'rekordbox'):
            return SyncResult(
                target=target,
                success=False,
                created=False,
                tracks_synced=0,
                tracks_unmatched=[],
                error=f"Invalid target: {target}"
            )

        # Load all playlists
        all_playlists = self.load_all_playlists()

        # Find source playlist
        source_playlist = None
        for playlist in all_playlists[source]:
            if playlist.name == playlist_name:
                source_playlist = playlist
                break

        if not source_playlist:
            return SyncResult(
                target=target,
                success=False,
                created=False,
                tracks_synced=0,
                tracks_unmatched=[],
                error=f"Playlist '{playlist_name}' not found in {source}"
            )

        # Match tracks to target database
        if target == 'manadj':
            matched_tracks, unmatched = self._match_tracks_to_manadj(source_playlist.tracks)
        elif target == 'engine':
            matched_tracks, unmatched = self._match_tracks_to_engine(source_playlist.tracks)
        else:  # rekordbox
            matched_tracks, unmatched = self._match_tracks_to_rekordbox(source_playlist.tracks)

        # Check for unmatched tracks
        if unmatched and not ignore_missing_tracks:
            return SyncResult(
                target=target,
                success=False,
                created=False,
                tracks_synced=0,
                tracks_unmatched=unmatched,
                error=f"Some tracks could not be matched in {target}. Set ignore_missing_tracks=true to proceed."
            )

        # Sync to target (unless dry run)
        if not dry_run:
            try:
                if target == 'manadj':
                    created, was_created = self._sync_to_manadj(playlist_name, matched_tracks)
                elif target == 'engine':
                    created, was_created = self._sync_to_engine(playlist_name, matched_tracks)
                else:  # rekordbox
                    created, was_created = self._sync_to_rekordbox(playlist_name, matched_tracks)

                return SyncResult(
                    target=target,
                    success=True,
                    created=was_created,
                    tracks_synced=len(matched_tracks),
                    tracks_unmatched=unmatched
                )
            except Exception as e:
                return SyncResult(
                    target=target,
                    success=False,
                    created=False,
                    tracks_synced=0,
                    tracks_unmatched=unmatched,
                    error=str(e)
                )
        else:
            # Dry run - return what would happen
            return SyncResult(
                target=target,
                success=True,
                created=False,  # We don't know without checking
                tracks_synced=len(matched_tracks),
                tracks_unmatched=unmatched
            )

    def sync_playlist_to_all(
        self,
        playlist_name: str,
        source: str,
        ignore_missing_tracks: bool = False,
        dry_run: bool = False
    ) -> list[SyncResult]:
        """Sync playlist from source to all other available targets.

        Args:
            playlist_name: Name of playlist to sync
            source: Source database ('manadj', 'engine', or 'rekordbox')
            ignore_missing_tracks: If True, proceed even if some tracks can't be matched
            dry_run: If True, return results without committing changes

        Returns:
            List of SyncResult, one per target
        """
        results = []
        targets = []

        # Determine available targets (excluding source)
        if source != 'manadj':
            targets.append('manadj')
        if source != 'engine' and self.engine_db:
            targets.append('engine')
        if source != 'rekordbox' and self.rb_db:
            targets.append('rekordbox')

        # Sync to each target
        for target in targets:
            result = self.sync_playlist_to_target(
                playlist_name=playlist_name,
                source=source,
                target=target,
                ignore_missing_tracks=ignore_missing_tracks,
                dry_run=dry_run
            )
            results.append(result)

        return results

    # ========================================================================
    # Private Helper Methods
    # ========================================================================

    def _match_tracks_to_manadj(self, track_refs: list[TrackReference]) -> tuple[list, list[str]]:
        """Match TrackReferences to manadj Track objects.

        Args:
            track_refs: List of TrackReference objects from source playlist

        Returns:
            Tuple of (matched_tracks, unmatched_filenames)
        """
        from backend.models import Track

        # Load all manadj tracks
        all_tracks = self.manadj_session.query(Track).all()

        # Index by path and filename
        tracks_by_path, tracks_by_filename = index_tracks_by_path(
            all_tracks,
            lambda t: t.filename,
            lambda t: t.filename
        )

        matched = []
        unmatched = []

        for ref in track_refs:
            # Try two-tier matching
            track = match_track_two_tier(ref.path, tracks_by_path, tracks_by_filename)
            if track:
                matched.append(track)
            else:
                unmatched.append(ref.filename)

        return matched, unmatched

    def _match_tracks_to_engine(self, track_refs: list[TrackReference]) -> tuple[list, list[str]]:
        """Match TrackReferences to Engine DJ Track objects.

        Args:
            track_refs: List of TrackReference objects from source playlist

        Returns:
            Tuple of (matched_tracks, unmatched_filenames)
        """
        if not self.engine_db:
            return [], [ref.filename for ref in track_refs]

        from enginedj.models.track import Track as EDJTrack

        # Load all Engine DJ tracks
        all_tracks = list(self.engine_db.get_track())

        # Index by path and filename
        tracks_by_path, tracks_by_filename = index_tracks_by_path(
            all_tracks,
            lambda t: t.path,
            lambda t: t.path
        )

        matched = []
        unmatched = []

        for ref in track_refs:
            # Try two-tier matching
            track = match_track_two_tier(ref.path, tracks_by_path, tracks_by_filename)
            if track:
                matched.append(track)
            else:
                unmatched.append(ref.filename)

        return matched, unmatched

    def _match_tracks_to_rekordbox(self, track_refs: list[TrackReference]) -> tuple[list, list[str]]:
        """Match TrackReferences to Rekordbox DjmdContent objects.

        Args:
            track_refs: List of TrackReference objects from source playlist

        Returns:
            Tuple of (matched_tracks, unmatched_filenames)
        """
        if not self.rb_db:
            return [], [ref.filename for ref in track_refs]

        from pyrekordbox.db6.tables import DjmdContent

        # Load all Rekordbox tracks
        all_tracks = list(self.rb_db.get_content())

        # Index by path and filename
        tracks_by_path, tracks_by_filename = index_tracks_by_path(
            all_tracks,
            lambda t: t.FolderPath,
            lambda t: t.FolderPath
        )

        matched = []
        unmatched = []

        for ref in track_refs:
            # Try two-tier matching
            track = match_track_two_tier(ref.path, tracks_by_path, tracks_by_filename)
            if track:
                matched.append(track)
            else:
                unmatched.append(ref.filename)

        return matched, unmatched

    def _sync_to_manadj(self, playlist_name: str, tracks: list) -> tuple[bool, bool]:
        """Write playlist to manadj database.

        Args:
            playlist_name: Name of playlist to create/update
            tracks: List of manadj Track objects

        Returns:
            Tuple of (success, was_created)
        """
        from backend.models import Playlist, PlaylistTrack

        # Find existing playlist by name
        existing = self.manadj_session.query(Playlist).filter(
            Playlist.name == playlist_name
        ).first()

        if existing:
            # Update existing playlist
            # Delete all existing PlaylistTrack records
            self.manadj_session.query(PlaylistTrack).filter(
                PlaylistTrack.playlist_id == existing.id
            ).delete()

            # Create new PlaylistTrack records
            for i, track in enumerate(tracks):
                pt = PlaylistTrack(
                    playlist_id=existing.id,
                    track_id=track.id,
                    position=i
                )
                self.manadj_session.add(pt)

            self.manadj_session.commit()
            return True, False
        else:
            # Create new playlist
            playlist = Playlist(name=playlist_name)
            self.manadj_session.add(playlist)
            self.manadj_session.flush()  # Get ID

            # Create PlaylistTrack records
            for i, track in enumerate(tracks):
                pt = PlaylistTrack(
                    playlist_id=playlist.id,
                    track_id=track.id,
                    position=i
                )
                self.manadj_session.add(pt)

            self.manadj_session.commit()
            return True, True

    def _sync_to_engine(self, playlist_name: str, tracks: list) -> tuple[bool, bool]:
        """Write playlist to Engine DJ database.

        Args:
            playlist_name: Name of playlist to create/update
            tracks: List of Engine DJ Track objects

        Returns:
            Tuple of (success, was_created)
        """
        if not self.engine_db:
            raise ValueError("Engine DJ database not available")

        from enginedj.playlist import create_or_update_playlist

        # Parse hierarchy
        parent_names, leaf_name = self._parse_hierarchy(playlist_name)

        # Ensure parent playlists exist
        parent_id = self._ensure_parent_playlists_engine(parent_names)

        # Create or update playlist
        with self.engine_db.session() as edj_session:
            playlist, was_created = create_or_update_playlist(
                edj_session=edj_session,
                title=leaf_name,
                parent_id=parent_id,
                edj_tracks=tracks,
                db_uuid=self.engine_db.db_uuid
            )
            edj_session.commit()

        return True, was_created

    def _sync_to_rekordbox(self, playlist_name: str, tracks: list) -> tuple[bool, bool]:
        """Write playlist to Rekordbox database.

        Args:
            playlist_name: Name of playlist to create/update
            tracks: List of Rekordbox DjmdContent objects

        Returns:
            Tuple of (success, was_created)
        """
        if not self.rb_db:
            raise ValueError("Rekordbox database not available")

        from rekordbox.playlist import create_or_update_playlist

        # Parse hierarchy
        parent_names, leaf_name = self._parse_hierarchy(playlist_name)

        # Ensure parent playlists exist
        parent_id = self._ensure_parent_playlists_rekordbox(parent_names)

        # Create or update playlist
        playlist, was_created = create_or_update_playlist(
            rb_db=self.rb_db,
            name=leaf_name,
            parent_id=parent_id,
            rb_tracks=tracks
        )
        self.rb_db.commit(autoinc=True)

        return True, was_created

    def _parse_hierarchy(self, playlist_name: str) -> tuple[list[str], str]:
        """Parse playlist name into hierarchy parts.

        Args:
            playlist_name: Flattened name like "Parent > Child > Name"

        Returns:
            Tuple of (parent_names, leaf_name)
        """
        parts = [p.strip() for p in playlist_name.split('>')]
        if len(parts) == 1:
            return [], parts[0]
        else:
            return parts[:-1], parts[-1]

    def _ensure_parent_playlists_engine(self, parent_names: list[str]) -> int:
        """Ensure parent playlist hierarchy exists in Engine DJ.

        Args:
            parent_names: List of parent names in order (e.g., ['Parent', 'Child'])

        Returns:
            Parent ID for the leaf playlist (0 if no parents)
        """
        if not parent_names:
            return 0

        if not self.engine_db:
            raise ValueError("Engine DJ database not available")

        from enginedj.playlist import find_playlist_by_title_and_parent, create_or_update_playlist

        current_parent_id = 0

        with self.engine_db.session() as edj_session:
            for name in parent_names:
                # Check if this level exists
                existing = find_playlist_by_title_and_parent(edj_session, name, current_parent_id)

                if existing:
                    current_parent_id = existing.id
                else:
                    # Create this level
                    playlist, _ = create_or_update_playlist(
                        edj_session=edj_session,
                        title=name,
                        parent_id=current_parent_id,
                        edj_tracks=[],
                        db_uuid=self.engine_db.db_uuid
                    )
                    current_parent_id = playlist.id

            edj_session.commit()

        return current_parent_id

    def _ensure_parent_playlists_rekordbox(self, parent_names: list[str]) -> str:
        """Ensure parent playlist hierarchy exists in Rekordbox.

        Args:
            parent_names: List of parent names in order (e.g., ['Parent', 'Child'])

        Returns:
            Parent ID for the leaf playlist (empty string if no parents)
        """
        if not parent_names:
            return ""

        if not self.rb_db:
            raise ValueError("Rekordbox database not available")

        from rekordbox.playlist import find_playlist_by_name_and_parent, create_or_update_playlist

        current_parent_id = ""

        for name in parent_names:
            # Check if this level exists
            existing = find_playlist_by_name_and_parent(self.rb_db, name, current_parent_id)

            if existing:
                current_parent_id = existing.ID
            else:
                # Create this level
                playlist, _ = create_or_update_playlist(
                    rb_db=self.rb_db,
                    name=name,
                    parent_id=current_parent_id,
                    rb_tracks=[]
                )
                current_parent_id = playlist.ID

        self.rb_db.commit(autoinc=True)

        return current_parent_id

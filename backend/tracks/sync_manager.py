"""Track synchronization manager - orchestration class."""

from sqlalchemy.orm import Session

from .models import TrackDiscrepancy, TrackSyncStats, TrackSyncResult


class TrackSyncManager:
    """Orchestrates track discrepancy detection across systems."""

    def __init__(self, manadj_session: Session, engine_db=None, rb_db=None):
        """Initialize with database connections.

        Args:
            manadj_session: Required manadj SQLAlchemy session
            engine_db: Optional EngineDJDatabase instance
            rb_db: Optional Rekordbox6Database instance
        """
        self.manadj_session = manadj_session
        self.engine_db = engine_db
        self.rb_db = rb_db

    def get_engine_discrepancies(
        self,
        validate_files: bool = False
    ) -> TrackSyncResult:
        """Get track discrepancies between manadj and Engine DJ.

        Args:
            validate_files: If True, skip tracks where file doesn't exist

        Returns:
            TrackSyncResult with both directions
        """
        from enginedj.sync import (
            find_missing_tracks_in_enginedj,
            find_missing_tracks_in_manadj
        )

        # Use Engine DJ session context manager
        with self.engine_db.session_m() as edj_session:
            # Direction 1: manadj → Engine DJ (export candidates)
            missing_in_edj, export_stats = find_missing_tracks_in_enginedj(
                self.manadj_session,
                edj_session,
                validate_paths=validate_files
            )

            # Direction 2: Engine DJ → manadj (import candidates)
            missing_in_manadj, import_stats = find_missing_tracks_in_manadj(
                self.manadj_session,
                edj_session
            )

            # Convert to TrackDiscrepancy objects
            export_discrepancies = [
                TrackDiscrepancy(
                    filename=t.filename,
                    title=t.title,
                    artist=t.artist,
                    bpm=t.bpm,
                    key=t.key,
                    source_system='manadj'
                )
                for t in missing_in_edj
            ]

            import_discrepancies = [
                TrackDiscrepancy(
                    filename=t.path,
                    title=t.title,
                    artist=t.artist,
                    bpm=t.bpm,
                    key=t.key,
                    source_system='engine'
                )
                for t in missing_in_manadj
            ]

            stats = TrackSyncStats(
                manadj_total=export_stats['manadj_tracks'],
                target_total=export_stats['enginedj_tracks'],
                missing_in_target_count=export_stats['missing_count'],
                missing_in_manadj_count=import_stats['missing_count'],
                skipped_file_not_found=export_stats.get('skipped_file_not_found', 0)
            )

            return TrackSyncResult(
                target='engine',
                stats=stats,
                missing_in_target=export_discrepancies,
                missing_in_manadj=import_discrepancies
            )

    def get_rekordbox_discrepancies(
        self,
        validate_files: bool = False
    ) -> TrackSyncResult:
        """Get track discrepancies between manadj and Rekordbox.

        Args:
            validate_files: If True, skip tracks where file doesn't exist

        Returns:
            TrackSyncResult with both directions
        """
        from rekordbox.sync import (
            find_missing_tracks_in_rekordbox,
            find_missing_tracks_in_manadj_from_rekordbox
        )

        # Direction 1: manadj → Rekordbox (export candidates)
        missing_in_rb, export_stats = find_missing_tracks_in_rekordbox(
            self.manadj_session,
            self.rb_db,
            validate_paths=validate_files
        )

        # Direction 2: Rekordbox → manadj (import candidates)
        missing_in_manadj, import_stats = find_missing_tracks_in_manadj_from_rekordbox(
            self.manadj_session,
            self.rb_db
        )

        # Convert to TrackDiscrepancy objects
        export_discrepancies = [
            TrackDiscrepancy(
                filename=t.filename,
                title=t.title,
                artist=t.artist,
                bpm=t.bpm,
                key=t.key,
                source_system='manadj'
            )
            for t in missing_in_rb
        ]

        import_discrepancies = [
            TrackDiscrepancy(
                filename=t.FolderPath,
                title=t.Title,
                artist=t.Artist.Name if hasattr(t, 'Artist') and t.Artist else None,
                bpm=t.BPM if t.BPM else None,  # Rekordbox stores BPM in centiBPM format
                key=t.KeyID if hasattr(t, 'KeyID') and t.KeyID else None,
                source_system='rekordbox'
            )
            for t in missing_in_manadj
        ]

        stats = TrackSyncStats(
            manadj_total=export_stats['manadj_tracks'],
            target_total=export_stats['rekordbox_tracks'],
            missing_in_target_count=export_stats['missing_count'],
            missing_in_manadj_count=import_stats['missing_count'],
            skipped_file_not_found=export_stats.get('skipped_file_not_found', 0)
        )

        return TrackSyncResult(
            target='rekordbox',
            stats=stats,
            missing_in_target=export_discrepancies,
            missing_in_manadj=import_discrepancies
        )

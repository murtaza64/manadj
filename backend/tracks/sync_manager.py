"""Track synchronization manager - orchestration class.

Track presence Match (which tracks exist on one side but not the other) is
single-homed in ``backend.sync_common.matching``; the Engine and Rekordbox
diff wrappers there call it. This manager used to carry two ~70-line
near-duplicate methods differing only in row field-name casing and session
lifecycle. Both now flow through one ``_discrepancies`` engine, parameterized
by a small per-surface descriptor that names where the diff comes from and how
to read a downstream row's fields — the surface-specific detail the seam
isolates.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from .models import TrackDiscrepancy, TrackSyncStats, TrackSyncResult


@dataclass
class _SurfaceDiff:
    """One surface's contribution to a bidirectional track diff.

    ``target`` is the surface id; ``export_fn``/``import_fn`` return
    (rows, stats) for the two directions; ``import_fields`` reads a downstream
    row into the fields a TrackDiscrepancy carries (the only thing that used to
    differ between the Engine and Rekordbox copies — attribute casing). The
    stats keys differ per vendor, so ``target_total_key`` names the count key.
    """

    target: str
    export_fn: Callable[[], tuple[list[Any], dict[str, int]]]
    import_fn: Callable[[], tuple[list[Any], dict[str, int]]]
    import_fields: Callable[[Any], TrackDiscrepancy]
    target_total_key: str


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
            find_missing_tracks_in_manadj,
        )

        # Engine's session lifecycle stays owned here (context manager); the
        # shared engine below never sees it.
        with self.engine_db.session_m() as edj_session:
            diff = _SurfaceDiff(
                target="engine",
                export_fn=lambda: find_missing_tracks_in_enginedj(
                    self.manadj_session, edj_session, validate_paths=validate_files
                ),
                import_fn=lambda: find_missing_tracks_in_manadj(
                    self.manadj_session, edj_session
                ),
                import_fields=lambda t: TrackDiscrepancy(
                    filename=t.path,
                    title=t.title,
                    artist=t.artist,
                    bpm=t.bpm,
                    key=t.key,
                    source_system="engine",
                ),
                target_total_key="enginedj_tracks",
            )
            return self._discrepancies(diff)

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
            find_missing_tracks_in_manadj_from_rekordbox,
            find_missing_tracks_in_rekordbox,
        )

        diff = _SurfaceDiff(
            target="rekordbox",
            export_fn=lambda: find_missing_tracks_in_rekordbox(
                self.manadj_session, self.rb_db, validate_paths=validate_files
            ),
            import_fn=lambda: find_missing_tracks_in_manadj_from_rekordbox(
                self.manadj_session, self.rb_db
            ),
            import_fields=lambda t: TrackDiscrepancy(
                filename=t.FolderPath,
                title=t.Title,
                # Rekordbox stores BPM in centiBPM format
                artist=t.Artist.Name if hasattr(t, "Artist") and t.Artist else None,
                bpm=t.BPM if t.BPM else None,
                key=t.KeyID if hasattr(t, "KeyID") and t.KeyID else None,
                source_system="rekordbox",
            ),
            target_total_key="rekordbox_tracks",
        )
        return self._discrepancies(diff)

    def _discrepancies(self, diff: _SurfaceDiff) -> TrackSyncResult:
        """The single bidirectional-diff engine both surfaces flow through."""
        missing_in_target, export_stats = diff.export_fn()
        missing_in_manadj, import_stats = diff.import_fn()

        export_discrepancies = [
            TrackDiscrepancy(
                filename=t.filename,
                title=t.title,
                artist=t.artist,
                bpm=t.bpm,
                key=t.key,
                source_system="manadj",
            )
            for t in missing_in_target
        ]
        import_discrepancies = [diff.import_fields(t) for t in missing_in_manadj]

        stats = TrackSyncStats(
            manadj_total=export_stats["manadj_tracks"],
            target_total=export_stats[diff.target_total_key],
            missing_in_target_count=export_stats["missing_count"],
            missing_in_manadj_count=import_stats["missing_count"],
            skipped_file_not_found=export_stats.get("skipped_file_not_found", 0),
        )

        return TrackSyncResult(
            target=diff.target,
            stats=stats,
            missing_in_target=export_discrepancies,
            missing_in_manadj=import_discrepancies,
        )

"""playlist entry identity unique constraint

Revision ID: 0011_rmwnmxnk
Revises: 0010_qnxmltss
Create Date: 2026-07-04 17:06:47.608385

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0011_rmwnmxnk'
down_revision: Union[str, Sequence[str], None] = '0010_qnxmltss'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Dedupe playlist entries, compact positions, and enforce (playlist, track) uniqueness."""
    # Keep one row per (playlist_id, track_id): the one with the lowest position (ties: lowest id).
    op.execute(
        """
        DELETE FROM playlist_tracks
        WHERE id NOT IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY playlist_id, track_id
                    ORDER BY position, id
                ) AS rn
                FROM playlist_tracks
            )
            WHERE rn = 1
        )
        """
    )
    # Compact positions per playlist to a contiguous 0..n-1 (stable by old position, then id).
    op.execute(
        """
        UPDATE playlist_tracks SET position = (
            SELECT COUNT(*)
            FROM playlist_tracks AS other
            WHERE other.playlist_id = playlist_tracks.playlist_id
              AND (other.position < playlist_tracks.position
                   OR (other.position = playlist_tracks.position
                       AND other.id < playlist_tracks.id))
        )
        """
    )
    op.create_index(
        "uq_playlist_tracks_playlist_track",
        "playlist_tracks",
        ["playlist_id", "track_id"],
        unique=True,
    )


def downgrade() -> None:
    """Drop the uniqueness constraint (deduped rows are not restored)."""
    op.drop_index("uq_playlist_tracks_playlist_track", table_name="playlist_tracks")

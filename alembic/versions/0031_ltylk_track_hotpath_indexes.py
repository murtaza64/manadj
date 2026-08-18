"""track_hotpath_indexes

Revision ID: 0031_ltylk
Revises: 0030_lwnvomwq
Create Date: 2026-08-18 17:25:44.484144

Hot-path Track indexes (performance-hardening 03). Session/Take/Transition/Set
lookups are already indexed — Track was the gap:

- ix_tracks_archived_at: the is_active predicate (archived_at IS NULL) filters
  every listing/Export/discovery query (crud.get_tracks:43-45).
- ix_tracks_active_created_at: partial index on created_at over the active
  rows only — covers the DEFAULT library browse exactly (active + newest-first,
  crud.get_tracks:154-155) with a pre-sorted, archived-free scan.
- ix_tracks_bpm: Follow mode's dyadic BPM-fold gate filters Track.bpm on every
  followed-track change (crud.get_tracks:104-117).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0031_ltylk'
down_revision: Union[str, Sequence[str], None] = '0030_lwnvomwq'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_tracks_archived_at", "tracks", ["archived_at"])
    op.create_index(
        "ix_tracks_active_created_at",
        "tracks",
        ["created_at"],
        sqlite_where=sa.text("archived_at IS NULL"),
    )
    op.create_index("ix_tracks_bpm", "tracks", ["bpm"])


def downgrade() -> None:
    op.drop_index("ix_tracks_bpm", table_name="tracks")
    op.drop_index("ix_tracks_active_created_at", table_name="tracks")
    op.drop_index("ix_tracks_archived_at", table_name="tracks")

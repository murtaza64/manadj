"""track-links-table

Revision ID: 0017_louonyzm
Revises: 0016_lvulxzsq
Create Date: 2026-07-05 01:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0017_louonyzm'
down_revision: Union[str, Sequence[str], None] = '0016_lvulxzsq'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the track_links table (linked-pairs PRD, issue 01)."""
    op.create_table(
        "track_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("low_track_id", sa.Integer(), nullable=False),
        sa.Column("high_track_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("low_track_id < high_track_id", name="ck_track_links_ordered"),
        sa.ForeignKeyConstraint(["low_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["high_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_track_links_id", "track_links", ["id"])
    op.create_index(
        "idx_track_links_pair",
        "track_links",
        ["low_track_id", "high_track_id"],
        unique=True,
    )
    op.create_index("idx_track_links_high", "track_links", ["high_track_id"])


def downgrade() -> None:
    """Drop the track_links table."""
    op.drop_table("track_links")

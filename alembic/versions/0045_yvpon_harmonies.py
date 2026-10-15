"""harmonies (chord-match #387)

Revision ID: 0045_yvpon
Revises: 0044_xzqvp
Create Date: 2026-10-15 06:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0045_yvpon'
down_revision: Union[str, Sequence[str], None] = '0044_xzqvp'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Per-Track harmony analysis artifact (drop chord loop)."""
    op.create_table(
        "harmonies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("track_id", sa.Integer(), sa.ForeignKey("tracks.id"), nullable=False),
        sa.Column("analyzer_version", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("bar_count", sa.Integer(), nullable=False),
        sa.Column("first_bar_s", sa.Float(), nullable=True),
        sa.Column("bar_chroma_blob", sa.LargeBinary(), nullable=False),
        sa.Column("drop_start_bar", sa.Integer(), nullable=True),
        sa.Column("drop_end_bar", sa.Integer(), nullable=True),
        sa.Column("drop_start_s", sa.Float(), nullable=True),
        sa.Column("loop_blob", sa.LargeBinary(), nullable=True),
        sa.Column("loop_reps", sa.Integer(), nullable=True),
        sa.Column("movement", sa.Float(), nullable=True),
        sa.Column("consistency", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_harmonies_id", "harmonies", ["id"])
    op.create_index("ix_harmonies_track_id", "harmonies", ["track_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_harmonies_track_id", table_name="harmonies")
    op.drop_index("ix_harmonies_id", table_name="harmonies")
    op.drop_table("harmonies")

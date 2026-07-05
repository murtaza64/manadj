"""sets-and-set-entries-tables

Revision ID: 0019_mtwlsrnp
Revises: 0018_nxxvnwvm
Create Date: 2026-07-05 14:41:54.590340

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0019_mtwlsrnp'
down_revision: Union[str, Sequence[str], None] = '0018_nxxvnwvm'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the sets and set_entries tables (sets PRD, issue 01)."""
    op.create_table(
        "sets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("display_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sets_id", "sets", ["id"])

    op.create_table(
        "set_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_set_entries_id", "set_entries", ["id"])
    op.create_index("idx_set_entries_set", "set_entries", ["set_id"])
    op.create_index("idx_set_entries_position", "set_entries", ["set_id", "position"])
    op.create_index(
        "uq_set_entries_set_track",
        "set_entries",
        ["set_id", "track_id"],
        unique=True,
    )


def downgrade() -> None:
    """Drop the set_entries and sets tables."""
    op.drop_table("set_entries")
    op.drop_table("sets")

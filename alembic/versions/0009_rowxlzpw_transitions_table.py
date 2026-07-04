"""transitions-table

Revision ID: 0009_rowxlzpw
Revises: 0008_otwxtmsn
Create Date: 2026-07-04 15:00:41.606192

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009_rowxlzpw'
down_revision: Union[str, Sequence[str], None] = '0008_otwxtmsn'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the transitions table (ADR 0011)."""
    op.create_table(
        "transitions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("a_track_id", sa.Integer(), nullable=False),
        sa.Column("b_track_id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("favorite", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("data_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["a_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["b_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transitions_id", "transitions", ["id"])
    op.create_index("idx_transitions_a", "transitions", ["a_track_id"])
    op.create_index("idx_transitions_b", "transitions", ["b_track_id"])
    op.create_index(
        "idx_transitions_pair_uuid",
        "transitions",
        ["a_track_id", "b_track_id", "uuid"],
        unique=True,
    )


def downgrade() -> None:
    """Drop the transitions table."""
    op.drop_table("transitions")

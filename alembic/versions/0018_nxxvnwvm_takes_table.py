"""takes-table

Revision ID: 0018_nxxvnwvm
Revises: 0017_louonyzm
Create Date: 2026-07-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0018_nxxvnwvm'
down_revision: Union[str, Sequence[str], None] = '0017_louonyzm'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the takes table (ADR 0020, transition-takes 02)."""
    op.create_table(
        "takes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("a_track_id", sa.Integer(), nullable=False),
        sa.Column("b_track_id", sa.Integer(), nullable=False),
        sa.Column("detected_at", sa.DateTime(), nullable=False),
        sa.Column("window_start_s", sa.Float(), nullable=False),
        sa.Column("window_end_s", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("detector_version", sa.Integer(), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=False),
        sa.Column("events_json", sa.Text(), nullable=False),
        sa.Column("promoted_transition_uuid", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["a_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["b_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_takes_id", "takes", ["id"])
    op.create_index("idx_takes_uuid", "takes", ["uuid"], unique=True)
    op.create_index("idx_takes_a", "takes", ["a_track_id"])
    op.create_index("idx_takes_b", "takes", ["b_track_id"])
    op.create_index("idx_takes_detected_at", "takes", ["detected_at"])


def downgrade() -> None:
    op.drop_table("takes")

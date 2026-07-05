"""set-dormant-pins-table

Revision ID: 0022_mwzqllkt
Revises: 0021_oxwwnsvl
Create Date: 2026-07-05 18:56:46.355292

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0022_mwzqllkt'
down_revision: Union[str, Sequence[str], None] = '0021_oxwwnsvl'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the set_dormant_pins table (sets 07, "Dormant pin"): a
    Set's memory of a pin whose adjacency was broken by reorder/removal,
    kept per ORDERED track pair, per Set — restored automatically when
    that pair becomes adjacent in that Set again. pin_uuid is not a
    foreign key (stored as asserted, like set_entries pins); track ids
    are (a deleted Track takes its memories with it)."""
    op.create_table(
        "set_dormant_pins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("a_track_id", sa.Integer(), nullable=False),
        sa.Column("b_track_id", sa.Integer(), nullable=False),
        sa.Column("pin_kind", sa.String(), nullable=False),
        sa.Column("pin_uuid", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["a_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["b_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_set_dormant_pins_id", "set_dormant_pins", ["id"])
    op.create_index("idx_set_dormant_pins_set", "set_dormant_pins", ["set_id"])
    op.create_index(
        "uq_set_dormant_pins_set_pair",
        "set_dormant_pins",
        ["set_id", "a_track_id", "b_track_id"],
        unique=True,
    )


def downgrade() -> None:
    """Drop the set_dormant_pins table."""
    op.drop_table("set_dormant_pins")

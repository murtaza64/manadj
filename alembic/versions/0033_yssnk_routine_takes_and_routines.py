"""routine takes and routines

Routine Take (hand-confirmed span of a Session, deck-literal event slice
reference) and Routine (saved slot-addressed, beat-domain choreography) —
ADR 0035, routines 158.

Revision ID: 0033_yssnk
Revises: 0032_xlquy
Create Date: 2026-08-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0033_yssnk'
down_revision: Union[str, Sequence[str], None] = '0032_xlquy'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "routine_takes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("session_uuid", sa.String(), nullable=False),
        sa.Column("entry_track_id", sa.Integer(), nullable=False),
        sa.Column("exit_track_id", sa.Integer(), nullable=False),
        sa.Column("cast_json", sa.Text(), nullable=False),
        sa.Column("window_start_s", sa.Float(), nullable=False),
        sa.Column("window_end_s", sa.Float(), nullable=False),
        sa.Column("entry_offsets_json", sa.Text(), nullable=False),
        sa.Column("origin_candidate_uuid", sa.String(), nullable=True),
        sa.Column("promoted_routine_uuid", sa.String(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_routine_takes_uuid", "routine_takes", ["uuid"], unique=True)
    op.create_index("idx_routine_takes_session", "routine_takes", ["session_uuid"])
    op.create_index("idx_routine_takes_entry", "routine_takes", ["entry_track_id"])

    op.create_table(
        "routines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("entry_track_id", sa.Integer(), nullable=False),
        sa.Column("exit_track_id", sa.Integer(), nullable=False),
        sa.Column("cast_json", sa.Text(), nullable=False),
        sa.Column("entry_offsets_beats_json", sa.Text(), nullable=False),
        sa.Column("entry_positions_json", sa.Text(), nullable=False),
        sa.Column("duration_beats", sa.Float(), nullable=False),
        sa.Column("events_json", sa.Text(), nullable=False),
        sa.Column("origin_take_uuid", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_routines_uuid", "routines", ["uuid"], unique=True)
    op.create_index("idx_routines_entry", "routines", ["entry_track_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_routines_entry", table_name="routines")
    op.drop_index("idx_routines_uuid", table_name="routines")
    op.drop_table("routines")
    op.drop_index("idx_routine_takes_entry", table_name="routine_takes")
    op.drop_index("idx_routine_takes_session", table_name="routine_takes")
    op.drop_index("idx_routine_takes_uuid", table_name="routine_takes")
    op.drop_table("routine_takes")

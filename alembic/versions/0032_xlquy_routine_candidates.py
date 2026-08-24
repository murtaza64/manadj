"""routine candidates

Persisted Routine-miner suggestion rows (ADR 0035, routines 157): the
`routine_candidates` table plus the `sessions.routine_miner_version`
currency marker the backfill sweep keys on.

Revision ID: 0032_xlquy
Revises: 0031_ltylk
Create Date: 2026-08-24 18:38:32.068296

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0032_xlquy'
down_revision: Union[str, Sequence[str], None] = '0031_ltylk'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "routine_candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("session_uuid", sa.String(), nullable=False),
        sa.Column("entry_track_id", sa.Integer(), nullable=False),
        sa.Column("exit_track_id", sa.Integer(), nullable=False),
        sa.Column("cast_json", sa.Text(), nullable=False),
        sa.Column("window_start_s", sa.Float(), nullable=False),
        sa.Column("window_end_s", sa.Float(), nullable=False),
        sa.Column("entry_offsets_json", sa.Text(), nullable=False),
        sa.Column("evidence_json", sa.Text(), nullable=False),
        sa.Column("miner_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_routine_candidates_uuid", "routine_candidates", ["uuid"], unique=True)
    op.create_index("idx_routine_candidates_session", "routine_candidates", ["session_uuid"])
    op.create_index("idx_routine_candidates_entry", "routine_candidates", ["entry_track_id"])
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("routine_miner_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("routine_miner_version")
    op.drop_index("idx_routine_candidates_entry", table_name="routine_candidates")
    op.drop_index("idx_routine_candidates_session", table_name="routine_candidates")
    op.drop_index("idx_routine_candidates_uuid", table_name="routine_candidates")
    op.drop_table("routine_candidates")

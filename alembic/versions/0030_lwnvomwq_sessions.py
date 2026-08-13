"""sessions

Revision ID: 0030_lwnvomwq
Revises: 0029_yrvmv
Create Date: 2026-07-15

Sessions PRD, ADR 0033: the persisted whole capture-event log. Adds the
`sessions` header table + `session_chunks` append log, and gives `takes`
its Session provenance (`session_uuid`) and `origin` mark.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0030_lwnvomwq'
down_revision: Union[str, Sequence[str], None] = '0029_yrvmv'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sessions_id", "sessions", ["id"])
    op.create_index("idx_sessions_uuid", "sessions", ["uuid"], unique=True)
    op.create_index("idx_sessions_started_at", "sessions", ["started_at"])

    op.create_table(
        "session_chunks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("events_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_session_chunks_id", "session_chunks", ["id"])
    op.create_index("idx_session_chunks_session", "session_chunks", ["session_id"])
    op.create_index(
        "idx_session_chunks_session_seq",
        "session_chunks",
        ["session_id", "seq"],
        unique=True,
    )

    # Take provenance (ADR 0033). Pre-existing Takes are sessionless and
    # count as detected; origin is NOT NULL, backfilled via the default.
    with op.batch_alter_table("takes") as batch:
        batch.add_column(sa.Column("session_uuid", sa.String(), nullable=True))
        batch.add_column(
            sa.Column("origin", sa.String(), nullable=False, server_default="detected")
        )
    op.create_index("idx_takes_session", "takes", ["session_uuid"])


def downgrade() -> None:
    op.drop_index("idx_takes_session", table_name="takes")
    with op.batch_alter_table("takes") as batch:
        batch.drop_column("origin")
        batch.drop_column("session_uuid")
    op.drop_table("session_chunks")
    op.drop_table("sessions")

"""set-entry-trim

Revision ID: 0034_wqtstkrm
Revises: 0033_yssnk
Create Date: 2026-08-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0034_wqtstkrm'
down_revision: Union[str, Sequence[str], None] = '0033_yssnk'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add per-entry trim to set_entries (sets #164).

    An OFFSET from neutral in mixer-knob units (0 = neutral), never an
    absolute level — track Autogain (ADR 0034) composes with it when it
    lands. Neutral default backfills every existing row.
    """
    op.add_column(
        "set_entries",
        sa.Column("trim", sa.Float(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    """Drop the trim column."""
    op.drop_column("set_entries", "trim")

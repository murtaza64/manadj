"""routine-window

Revision ID: 0038_ulsvv
Revises: 0037_roxqp
Create Date: 2026-08-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0038_ulsvv'
down_revision: Union[str, Sequence[str], None] = '0037_roxqp'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The Routine's CURRENT capture-clock window (gh#190 item 8).

    Retrim was stateless against the origin take's original window, so a
    second trim silently reverted the first (the UI's beat amounts are
    relative to the current routine clock). Store the effective window on
    the Routine: set at promote (= take window), updated by every retrim.
    Null = pre-existing row; the retrim endpoint falls back to the take
    window (the old behavior) and self-heals on the first retrim.
    """
    op.add_column("routines", sa.Column("window_start_s", sa.Float(), nullable=True))
    op.add_column("routines", sa.Column("window_end_s", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("routines", "window_end_s")
    op.drop_column("routines", "window_start_s")

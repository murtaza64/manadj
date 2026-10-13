"""task-progress

Revision ID: 0043_zpron
Revises: 0042_kuxpn
Create Date: 2026-10-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0043_zpron'
down_revision: Union[str, Sequence[str], None] = '0042_kuxpn'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Task progress (gh#342): a 0..1 fraction and a short label written by
    handlers that can measure their work (downloads); null = unmeasured."""
    op.add_column("tasks", sa.Column("progress", sa.Float(), nullable=True))
    op.add_column("tasks", sa.Column("progress_label", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "progress_label")
    op.drop_column("tasks", "progress")

"""task-backoff-columns

Revision ID: 0027_mqqzn
Revises: 0026_rznonpxv
Create Date: 2026-07-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0027_mqqzn'
down_revision: Union[str, Sequence[str], None] = '0026_rznonpxv'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add rate-limit backoff bookkeeping to tasks (acquisition issue 08).

    attempts counts RateLimitedError retries; not_before is a deferral floor
    (a pending task is only picked once now() >= not_before). Existing rows
    default to attempts=0 / not_before=NULL (ready immediately).
    """
    op.add_column(
        "tasks",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("tasks", sa.Column("not_before", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Drop the backoff columns."""
    op.drop_column("tasks", "not_before")
    op.drop_column("tasks", "attempts")

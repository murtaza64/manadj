"""task-dismissed-at

Revision ID: 0029_yrvmv
Revises: 0028_kwxpv
Create Date: 2026-07-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0029_yrvmv"
down_revision: Union[str, Sequence[str], None] = "0028_kwxpv"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("dismissed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "dismissed_at")

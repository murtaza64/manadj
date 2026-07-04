"""track archived_at

Revision ID: 0015_xupryqxp
Revises: 0014_ppxknkuk
Create Date: 2026-07-04 18:34:05.076838

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015_xupryqxp'
down_revision: Union[str, Sequence[str], None] = '0014_ppxknkuk'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Track.archived_at: curation verdict timestamp (NULL = active)."""
    op.add_column("tracks", sa.Column("archived_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Drop the archived flag (verdicts are lost)."""
    op.drop_column("tracks", "archived_at")

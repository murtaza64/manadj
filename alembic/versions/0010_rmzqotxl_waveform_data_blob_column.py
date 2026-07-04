"""waveform data blob column

Revision ID: 0010_rmzqotxl
Revises: 0009_rowxlzpw
Create Date: 2026-07-04 17:02:18.591314

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010_rmzqotxl'
down_revision: Union[str, Sequence[str], None] = '0009_rowxlzpw'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the Waveform data v2 blob column (ADR 0014)."""
    op.add_column("waveforms", sa.Column("data_blob", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("waveforms", "data_blob")

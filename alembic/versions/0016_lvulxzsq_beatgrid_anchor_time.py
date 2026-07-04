"""beatgrid-anchor-time

Revision ID: 0016_lvulxzsq
Revises: 0015_xupryqxp
Create Date: 2026-07-04 18:52:42.145311

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0016_lvulxzsq'
down_revision: Union[str, Sequence[str], None] = '0015_xupryqxp'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add beatgrids.anchor_time (ADR 0016): the downbeat the user explicitly
    marked, in track-time seconds. Nullable — grids without a mark fall back
    to their first downbeat for anchor-preserving re-tempo."""
    op.add_column(
        "beatgrids",
        sa.Column("anchor_time", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    """Drop beatgrids.anchor_time."""
    with op.batch_alter_table("beatgrids") as batch:
        batch.drop_column("anchor_time")

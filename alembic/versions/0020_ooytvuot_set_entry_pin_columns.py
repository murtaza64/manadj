"""set-entry-pin-columns

Revision ID: 0020_ooytvuot
Revises: 0019_mtwlsrnp
Create Date: 2026-07-05 14:54:21.466870

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0020_ooytvuot'
down_revision: Union[str, Sequence[str], None] = '0019_mtwlsrnp'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add adjacency-pin columns to set_entries (sets 02).

    The entry's pin describes the adjacency it heads (this entry → the
    next): a Transition uuid, a Take uuid, or nothing (Unresolved).
    """
    op.add_column("set_entries", sa.Column("pin_kind", sa.String(), nullable=True))
    op.add_column("set_entries", sa.Column("pin_uuid", sa.String(), nullable=True))


def downgrade() -> None:
    """Drop the pin columns."""
    op.drop_column("set_entries", "pin_uuid")
    op.drop_column("set_entries", "pin_kind")

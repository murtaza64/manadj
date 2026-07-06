"""dormant-pin-uuid-nullable

Revision ID: 0023_lmmppypt
Revises: 0022_mwzqllkt
Create Date: 2026-07-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0023_lmmppypt'
down_revision: Union[str, Sequence[str], None] = '0022_mwzqllkt'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Allow NULL pin_uuid on Dormant pins (sets 26): the new Hard-cut
    pin kind references nothing, and dormancy round-trips it like any
    pin. set_entries.pin_uuid was nullable from the start."""
    with op.batch_alter_table("set_dormant_pins") as batch:
        batch.alter_column("pin_uuid", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("set_dormant_pins") as batch:
        batch.alter_column("pin_uuid", existing_type=sa.String(), nullable=False)

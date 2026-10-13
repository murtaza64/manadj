"""routine-slot-ids

Revision ID: 0041_qurns
Revises: 0040_snntw
Create Date: 2026-10-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0041_qurns'
down_revision: Union[str, Sequence[str], None] = '0040_snntw'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Stable slot ids on Routines (ADR 0039, gh#325).

    JSON list of client-minted slot ids, parallel to cast_json. Authored
    Routines always carry them (slots are added/removed/reordered); null
    = a promoted Routine, whose slot ids are the lossless migration
    identity String(index).
    """
    op.add_column("routines", sa.Column("slot_ids_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("routines", "slot_ids_json")

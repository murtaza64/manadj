"""routine-edits

Revision ID: 0036_qyskqolt
Revises: 0035_tkxst
Create Date: 2026-08-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0036_qyskqolt'
down_revision: Union[str, Sequence[str], None] = '0035_tkxst'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Authored edits over a Routine's recording (gh#170 pass 2).

    The Routine editor's draft layer: slot-indexed lane envelopes +
    Jump events on any slot, beat-domain, stored as opaque JSON (the
    events_json posture). The recording itself stays evidence and never
    changes; null = unedited.
    """
    op.add_column("routines", sa.Column("edits_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("routines", "edits_json")

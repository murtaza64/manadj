"""set-tempo-policy-columns

Revision ID: 0021_oxwwnsvl
Revises: 0020_ooytvuot
Create Date: 2026-07-05 17:41:55.907270

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0021_oxwwnsvl'
down_revision: Union[str, Sequence[str], None] = '0020_ooytvuot'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Per-Set Tempo policy (sets 06): "riding" | "fixed", plus the
    explicit Set tempo for Fixed (null = default from the first track's
    BPM at plan time)."""
    op.add_column(
        "sets",
        sa.Column("tempo_policy", sa.String(), nullable=False, server_default="riding"),
    )
    op.add_column("sets", sa.Column("set_tempo_bpm", sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("sets", "set_tempo_bpm")
    op.drop_column("sets", "tempo_policy")

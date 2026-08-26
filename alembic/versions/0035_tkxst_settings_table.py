"""settings table

Persisted UI preferences (settings, #176): key -> raw preference string
(the frontend's former localStorage payloads). DB is the source of truth
so sandbox/lane clones inherit the real app's settings; per-origin
localStorage becomes a write-through cache.

Revision ID: 0035_tkxst
Revises: 0034_wqtstkrm
Create Date: 2026-08-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0035_tkxst"
down_revision: Union[str, Sequence[str], None] = "0034_wqtstkrm"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "settings",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("settings")

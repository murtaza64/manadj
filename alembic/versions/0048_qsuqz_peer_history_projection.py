"""peer-history-projection

Revision ID: 0048_qsuqz
Revises: 0047_uxoxz
Create Date: 2026-11-02 02:26:35.354943

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0048_qsuqz'
down_revision: Union[str, Sequence[str], None] = '0047_uxoxz'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "peer_history",
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("binding_sha256", sa.String(64), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("peer_history")

"""peer-folder-transport

Revision ID: 0050_rxxlw
Revises: 0049_nllos
Create Date: 2026-11-02 03:01:38.784687

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0050_rxxlw'
down_revision: Union[str, Sequence[str], None] = '0049_nllos'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table("peer_folder_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("root", sa.Text(), nullable=False),
        sa.Column("token", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(80), nullable=False),
        sa.Column("cursor", sa.String(160), nullable=False),
        sa.CheckConstraint("id = 1"))
    op.create_table("peer_folder_publications",
        sa.Column("session_uuid", sa.String(36), sa.ForeignKey("peer_sync_sessions.session_uuid"), primary_key=True),
        sa.Column("published", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(80), nullable=False))
    op.create_table("peer_folder_receipts",
        sa.Column("artifact", sa.String(160), primary_key=True),
        sa.Column("received", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(80), nullable=False),
        sa.Column("readiness", sa.String(80)))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("peer_folder_receipts")
    op.drop_table("peer_folder_publications")
    op.drop_table("peer_folder_config")

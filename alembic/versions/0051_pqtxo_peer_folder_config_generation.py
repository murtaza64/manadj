"""peer-folder-config-generation

Revision ID: 0051_pqtxo
Revises: 0050_rxxlw
Create Date: 2026-11-02 03:38:14.081568

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0051_pqtxo'
down_revision: Union[str, Sequence[str], None] = '0050_rxxlw'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("peer_folder_config", sa.Column("generation", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("peer_folder_config", "generation")

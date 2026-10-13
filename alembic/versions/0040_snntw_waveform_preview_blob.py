"""waveform-preview-blob

Revision ID: 0040_snntw
Revises: 0039_kpplp
Create Date: 2026-09-11 01:09:31.496225

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0040_snntw'
down_revision: str | Sequence[str] | None = '0039_kpplp'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("waveforms", sa.Column("preview_blob", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("waveforms", "preview_blob")

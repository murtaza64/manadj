"""asserted audio provenance

Revision ID: 0006_mtqsrxsv
Revises: 0005_qzqmvyum
Create Date: 2026-07-02 21:57:13.005641

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_mtqsrxsv'
down_revision: Union[str, Sequence[str], None] = '0005_qzqmvyum'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema (hand-adjusted from autogen: rename, not drop-and-add)."""
    with op.batch_alter_table('audio_provenances', schema=None) as batch_op:
        batch_op.add_column(sa.Column('url', sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column('asserted', sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.alter_column('external_id', existing_type=sa.VARCHAR(), nullable=True)
        batch_op.alter_column(
            'downloaded_at', new_column_name='acquired_at', existing_type=sa.DATETIME()
        )
    # backfill url for existing recorded (soundcloud) rows from their source items
    op.execute(
        """
        UPDATE audio_provenances SET url = (
            SELECT permalink_url FROM source_items
            WHERE source_items.source = audio_provenances.source
              AND source_items.external_id = audio_provenances.external_id
        )
        WHERE url IS NULL
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('audio_provenances', schema=None) as batch_op:
        batch_op.alter_column(
            'acquired_at', new_column_name='downloaded_at', existing_type=sa.DATETIME()
        )
        batch_op.alter_column('external_id', existing_type=sa.VARCHAR(), nullable=False)
        batch_op.drop_column('asserted')
        batch_op.drop_column('url')

    # ### end Alembic commands ###

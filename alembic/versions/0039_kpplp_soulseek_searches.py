"""soulseek-searches

Revision ID: 0039_kpplp
Revises: 0038_ulsvv
Create Date: 2026-08-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0039_kpplp'
down_revision: Union[str, Sequence[str], None] = '0038_ulsvv'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remembered Soulseek searches, one row per Source Item (gh#216).

    Persists the query + shaped results of the latest search so the picker
    hydrates instantly on item selection, and so hands-off downloads
    (gh#214) have a candidate list to snapshot from.
    """
    op.create_table(
        "soulseek_searches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "source_item_id",
            sa.Integer(),
            sa.ForeignKey("source_items.id"),
            nullable=False,
        ),
        sa.Column("query", sa.String(), nullable=False),
        sa.Column("results_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("searched_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_soulseek_searches_source_item_id",
        "soulseek_searches",
        ["source_item_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_soulseek_searches_source_item_id", table_name="soulseek_searches")
    op.drop_table("soulseek_searches")

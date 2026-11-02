"""group_supplied_possession

Revision ID: 0054_xqtyy
Revises: 0053_xmlrs
Create Date: 2026-11-02 13:43:09.874804

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0054_xqtyy'
down_revision: Union[str, Sequence[str], None] = '0053_xmlrs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("device_group_possessions",
        sa.Column("group_id", sa.String(36), sa.ForeignKey("device_groups.group_id"), primary_key=True),
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("device_id", sa.String(36), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("proof_body_b64", sa.Text(), nullable=False),
        sa.Column("proof_signature_b64", sa.String(88), nullable=False))


def downgrade() -> None:
    op.drop_table("device_group_possessions")

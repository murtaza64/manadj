"""group_session_history

Revision ID: 0055_suwxw
Revises: 0054_xqtyy
Create Date: 2026-11-02 14:39:07.080947

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0055_suwxw'
down_revision: Union[str, Sequence[str], None] = '0054_xqtyy'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("device_group_members", sa.Column("label", sa.String(80), nullable=False, server_default="Own device"))
    op.create_table("device_group_history",
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("group_id", sa.String(36), sa.ForeignKey("device_groups.group_id"), nullable=False),
        sa.Column("operation_id", sa.String(36), nullable=False),
        sa.Column("origin_device_id", sa.String(36), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("manifest_sha256", sa.String(64), nullable=False))


def downgrade() -> None:
    op.drop_table("device_group_history")
    op.drop_column("device_group_members", "label")

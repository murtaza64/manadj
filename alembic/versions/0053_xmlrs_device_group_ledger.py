"""device_group_ledger

Revision ID: 0053_xmlrs
Revises: 0052_ptmxq
Create Date: 2026-11-02 13:14:21.600863

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0053_xmlrs'
down_revision: Union[str, Sequence[str], None] = '0052_ptmxq'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("device_groups",
        sa.Column("group_id", sa.String(36), primary_key=True),
        sa.Column("device_id", sa.String(36), nullable=False),
        sa.Column("private_seed_b64", sa.String(44), nullable=False))
    op.create_table("device_group_members",
        sa.Column("group_id", sa.String(36), sa.ForeignKey("device_groups.group_id"), primary_key=True),
        sa.Column("device_id", sa.String(36), primary_key=True),
        sa.Column("public_key_b64", sa.String(44), nullable=False),
        sa.Column("revoked", sa.Integer(), nullable=False))
    op.create_table("device_group_operations",
        sa.Column("cursor", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.String(36), sa.ForeignKey("device_groups.group_id"), nullable=False),
        sa.Column("operation_id", sa.String(36), nullable=False),
        sa.Column("origin_device_id", sa.String(36), nullable=False),
        sa.Column("session_uuid", sa.String(36), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("body_b64", sa.Text(), nullable=False),
        sa.Column("signature_b64", sa.String(88), nullable=False),
        sa.UniqueConstraint("group_id", "operation_id"), sqlite_autoincrement=True)
    op.create_table("device_group_acks",
        sa.Column("group_id", sa.String(36), sa.ForeignKey("device_groups.group_id"), primary_key=True),
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("device_id", sa.String(36), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False))


def downgrade() -> None:
    for table in ("device_group_acks", "device_group_operations", "device_group_members", "device_groups"):
        op.drop_table(table)

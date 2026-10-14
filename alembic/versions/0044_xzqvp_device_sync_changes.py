"""device sync changes

Revision ID: 0044_xzqvp
Revises: 0043_zpron
Create Date: 2026-10-14 12:09:32.986417

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0044_xzqvp'
down_revision: Union[str, Sequence[str], None] = '0043_zpron'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Device change log (ADR 0045, #375)."""
    op.create_table(
        "device_sync_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("device_name", sa.String(), nullable=True),
        sa.Column("direction", sa.String(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=True),  # null: setting:<key> rows
        sa.Column("field", sa.String(), nullable=False),
        sa.Column("old_json", sa.Text(), nullable=True),
        sa.Column("new_json", sa.Text(), nullable=True),
        sa.Column("edit_uuid", sa.String(), nullable=True),
        sa.Column("edited_at", sa.DateTime(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("reverts_id", sa.Integer(), nullable=True),
        sa.Column("reverted_by_id", sa.Integer(), nullable=True),
    )
    op.create_index("idx_device_sync_changes_batch", "device_sync_changes", ["batch_id"])
    op.create_index("idx_device_sync_changes_track", "device_sync_changes", ["track_id"])
    op.create_index("idx_device_sync_changes_synced", "device_sync_changes", ["synced_at"])
    op.create_index("idx_device_sync_changes_edit_uuid", "device_sync_changes", ["edit_uuid"])


def downgrade() -> None:
    op.drop_table("device_sync_changes")

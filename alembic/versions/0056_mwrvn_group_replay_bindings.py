"""group_replay_bindings

Revision ID: 0056_mwrvn
Revises: 0055_suwxw
Create Date: 2026-11-02 17:23:37.695195

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0056_mwrvn'
down_revision: Union[str, Sequence[str], None] = '0055_suwxw'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("group_replay_selections",
        sa.Column("selection_id", sa.String(36), primary_key=True),
        sa.Column("track_id", sa.Integer(), sa.ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("incarnation", sa.String(64), nullable=False),
        sa.Column("asset_json", sa.Text(), nullable=False))
    op.create_table("group_replay_bindings",
        sa.Column("group_id", sa.String(36), sa.ForeignKey("device_groups.group_id"), primary_key=True),
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("logical_track_id", sa.String(36), primary_key=True),
        sa.Column("operation_sha256", sa.String(64), nullable=False),
        sa.Column("selection_id", sa.String(36), sa.ForeignKey("group_replay_selections.selection_id", ondelete="SET NULL")),
        sa.Column("incarnation", sa.String(64), nullable=False))


def downgrade() -> None:
    op.drop_table("group_replay_bindings")
    op.drop_table("group_replay_selections")

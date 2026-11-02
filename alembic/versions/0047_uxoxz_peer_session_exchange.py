"""peer_session_exchange

Revision ID: 0047_uxoxz
Revises: 0046_yumpp
Create Date: 2026-11-01 23:40:23.849620

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0047_uxoxz'
down_revision: Union[str, Sequence[str], None] = '0046_yumpp'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("peer_sync_local", sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("replica_id", sa.String(36), nullable=False, unique=True), sa.CheckConstraint("id = 1"))
    op.create_table("peer_sync_sources", sa.Column("replica_id", sa.String(36), primary_key=True),
                    sa.Column("label", sa.String(80), nullable=False))
    op.create_table("peer_sync_tracks", sa.Column("logical_track_id", sa.String(36), primary_key=True),
                    sa.Column("track_id", sa.Integer(), sa.ForeignKey("tracks.id", ondelete="SET NULL"), unique=True))
    op.create_table("peer_sync_selections", sa.Column("track_id", sa.Integer(),
                    sa.ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("token", sa.String(32), nullable=False))
    op.create_table("peer_sync_sessions", sa.Column("session_uuid", sa.String(36), primary_key=True),
                    sa.Column("origin_replica_id", sa.String(36), nullable=False),
                    sa.Column("direction", sa.String(8), nullable=False),
                    sa.Column("manifest_sha256", sa.String(64), nullable=False),
                    sa.Column("manifest_json", sa.Text(), nullable=False))
    op.create_table("peer_sync_chunks", sa.Column("session_uuid", sa.String(36),
                    sa.ForeignKey("peer_sync_sessions.session_uuid", ondelete="CASCADE"), primary_key=True),
                    sa.Column("seq", sa.Integer(), primary_key=True), sa.Column("events_json", sa.Text(), nullable=False))
    op.create_table("peer_sync_conflicts", sa.Column("payload_sha256", sa.String(64), primary_key=True),
                    sa.Column("session_uuid", sa.String(36), nullable=False),
                    sa.Column("existing_sha256", sa.String(64), nullable=False),
                    sa.Column("existing_kind", sa.String(32), nullable=False),
                    sa.Column("existing_json", sa.Text(), nullable=False),
                    sa.Column("incoming_json", sa.Text(), nullable=False))


def downgrade() -> None:
    for table in ("peer_sync_conflicts", "peer_sync_chunks", "peer_sync_sessions", "peer_sync_selections", "peer_sync_tracks", "peer_sync_sources", "peer_sync_local"):
        op.drop_table(table)

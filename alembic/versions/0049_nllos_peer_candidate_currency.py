"""Bind derived peer candidates to their mining generation.

Revision ID: 0049_nllos
Revises: 0048_qsuqz
"""
from alembic import op
import sqlalchemy as sa

revision = "0049_nllos"
down_revision = "0048_qsuqz"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("routine_candidates", sa.Column("peer_generation", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("routine_candidates", "peer_generation")

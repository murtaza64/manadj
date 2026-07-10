"""metric-ladders-table

Revision ID: 0028_kwxpv
Revises: 0027_mqqzn
Create Date: 2026-07-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0028_kwxpv'
down_revision: Union[str, Sequence[str], None] = '0027_mqqzn'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Persisted Metric-ladder deviations (ADR 0029, metric-ladder 02).

    One row per track, existing only when a user deviates from the computed
    default ladder (Reset marks or non-duple arities); the default is never
    persisted (placeholder posture).
    """
    op.create_table(
        "metric_ladders",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "track_id",
            sa.Integer(),
            sa.ForeignKey("tracks.id"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("arities_json", sa.Text(), nullable=False),
        sa.Column("reset_marks_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    """Drop metric_ladders."""
    op.drop_table("metric_ladders")

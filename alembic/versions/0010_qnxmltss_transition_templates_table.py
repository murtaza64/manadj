"""transition-templates-table

Revision ID: 0010_qnxmltss
Revises: 0009_rowxlzpw
Create Date: 2026-07-04 16:58:56.379032

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010_qnxmltss'
down_revision: Union[str, Sequence[str], None] = '0009_rowxlzpw'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the transition_templates table (mix-editor issue 03)."""
    op.create_table(
        "transition_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("align_a_base", sa.String(), nullable=False),
        sa.Column("align_a_delta_beats", sa.Integer(), nullable=False),
        sa.Column("align_b_base", sa.String(), nullable=False),
        sa.Column("align_b_delta_beats", sa.Integer(), nullable=False),
        sa.Column("length_beats", sa.Integer(), nullable=False),
        sa.Column("scalable", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("lanes_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transition_templates_id", "transition_templates", ["id"])
    op.create_index(
        "idx_transition_templates_uuid", "transition_templates", ["uuid"], unique=True
    )


def downgrade() -> None:
    """Drop the transition_templates table."""
    op.drop_table("transition_templates")

"""template-align-and-window

Revision ID: 0014_ppxknkuk
Revises: 0013_rqwtvtsu
Create Date: 2026-07-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014_ppxknkuk'
down_revision: Union[str, Sequence[str], None] = '0013_rqwtvtsu'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rework template anchors to align-and-window (mix-editor issue 28).

    Old model: per-side anchor rules coinciding at the window START
    (`align_a_delta_beats`, `align_b_delta_beats`, `length_beats`).
    New model: one alignment rule (B's base lands on A's base +
    `align_delta_beats`) and a window around the alignment instant
    (`before_beats`/`after_beats`).

    Existing rows convert EXACTLY. At the old window start B's track
    position was `baseB + dB`, so B's BARE anchor (the new reference)
    sits −dB beats after the window start:
        align_delta_beats = dA - dB
        before_beats      = -dB
        after_beats       = length_beats + dB
    (Worked example: alignA(cue4,+32), alignB(cue4,−32), length 64 —
    the old "drop alignment with 32-beat lead-in" — becomes delta 64,
    window 32/32: drops aligned, blend in 32 before, ride 32 after.)
    """
    op.add_column(
        "transition_templates",
        sa.Column("align_delta_beats", sa.Integer(), nullable=True),
    )
    op.add_column(
        "transition_templates",
        sa.Column("before_beats", sa.Integer(), nullable=True),
    )
    op.add_column(
        "transition_templates",
        sa.Column("after_beats", sa.Integer(), nullable=True),
    )
    op.execute(
        "UPDATE transition_templates SET "
        "align_delta_beats = align_a_delta_beats - align_b_delta_beats, "
        "before_beats = -align_b_delta_beats, "
        "after_beats = length_beats + align_b_delta_beats"
    )
    with op.batch_alter_table("transition_templates") as batch:
        batch.alter_column("align_delta_beats", nullable=False)
        batch.alter_column("before_beats", nullable=False)
        batch.alter_column("after_beats", nullable=False)
        batch.drop_column("align_a_delta_beats")
        batch.drop_column("align_b_delta_beats")
        batch.drop_column("length_beats")


def downgrade() -> None:
    """Reverse the column swap: dB = −before, dA = delta − before,
    length = before + after."""
    op.add_column(
        "transition_templates",
        sa.Column("align_a_delta_beats", sa.Integer(), nullable=True),
    )
    op.add_column(
        "transition_templates",
        sa.Column("align_b_delta_beats", sa.Integer(), nullable=True),
    )
    op.add_column(
        "transition_templates",
        sa.Column("length_beats", sa.Integer(), nullable=True),
    )
    op.execute(
        "UPDATE transition_templates SET "
        "align_a_delta_beats = align_delta_beats - before_beats, "
        "align_b_delta_beats = -before_beats, "
        "length_beats = before_beats + after_beats"
    )
    with op.batch_alter_table("transition_templates") as batch:
        batch.alter_column("align_a_delta_beats", nullable=False)
        batch.alter_column("align_b_delta_beats", nullable=False)
        batch.alter_column("length_beats", nullable=False)
        batch.drop_column("align_delta_beats")
        batch.drop_column("before_beats")
        batch.drop_column("after_beats")

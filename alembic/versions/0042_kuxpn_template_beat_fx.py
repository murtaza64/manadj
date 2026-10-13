"""template-beat-fx

Revision ID: 0042_kuxpn
Revises: 0041_qurns
Create Date: 2026-10-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0042_kuxpn'
down_revision: Union[str, Sequence[str], None] = '0041_qurns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Beat FX track on Transition templates (gh#353).

    Opaque JSON (TransitionBeatFx: steps + depth, normalized like lanes);
    null = the template carries no FX.
    """
    op.add_column("transition_templates", sa.Column("beat_fx_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("transition_templates", "beat_fx_json")

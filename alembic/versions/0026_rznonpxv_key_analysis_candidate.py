"""key-analysis-candidate

Revision ID: 0026_rznonpxv
Revises: 0025_rtnwlzpl
Create Date: 2026-07-06

Currency marker for analyzed keys (native-analysis-accuracy 11): which
backend produced the current `analyzed` key. NULL for keys whose provenance
was migration-backfilled (0025) — those are old-backend values the backfill
must refresh. Grids already carry their marker (GridAnalysis.candidate);
keys have no diagnostics row, so the marker lives on the Track.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0026_rznonpxv'
down_revision: Union[str, Sequence[str], None] = '0025_rtnwlzpl'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tracks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('key_analysis_candidate', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tracks', schema=None) as batch_op:
        batch_op.drop_column('key_analysis_candidate')

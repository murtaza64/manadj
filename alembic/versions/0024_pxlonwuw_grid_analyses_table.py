"""grid-analyses-table

Revision ID: 0024_pxlonwuw
Revises: 0023_lmmppypt
Create Date: 2026-07-06

Native grid Analysis (ADR 0024, native-analysis-accuracy 07): fit
diagnostics storage — one row per Track, overwritten per run. Supersedes
the old BPMAnalysis estimate rows (dropped, no data carried: estimates
were integer-snapped guesses, not evidence of anything the new fit keeps).
Beatgrid.origin gains the value "analyzed"; the column is an unconstrained
string, so no schema change — recorded here for the migration trail. The
needs-attention worklist is derived (bailed diagnostics + no saved grid),
not stored.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0024_pxlonwuw'
down_revision: Union[str, Sequence[str], None] = '0023_lmmppypt'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'grid_analyses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('track_id', sa.Integer(), nullable=False),
        sa.Column('candidate', sa.String(), nullable=False),
        sa.Column('bailed', sa.Boolean(), nullable=False),
        sa.Column('bpm', sa.Float(), nullable=True),
        sa.Column('phase', sa.Float(), nullable=True),
        sa.Column('residual_ms', sa.Float(), nullable=True),
        sa.Column('evidence_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['track_id'], ['tracks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('grid_analyses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_grid_analyses_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_grid_analyses_track_id'), ['track_id'], unique=True)

    with op.batch_alter_table('bpm_analyses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_bpm_analyses_track_id'))
        batch_op.drop_index(batch_op.f('ix_bpm_analyses_id'))
    op.drop_table('bpm_analyses')


def downgrade() -> None:
    op.create_table(
        'bpm_analyses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('track_id', sa.Integer(), nullable=False),
        sa.Column('estimates_json', sa.Text(), nullable=False),
        sa.Column('recommended_bpms_json', sa.Text(), nullable=False),
        sa.Column('recommended_bpm', sa.Integer(), nullable=False),
        sa.Column('duration', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['track_id'], ['tracks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('bpm_analyses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_bpm_analyses_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_bpm_analyses_track_id'), ['track_id'], unique=True)

    with op.batch_alter_table('grid_analyses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_grid_analyses_track_id'))
        batch_op.drop_index(batch_op.f('ix_grid_analyses_id'))
    op.drop_table('grid_analyses')

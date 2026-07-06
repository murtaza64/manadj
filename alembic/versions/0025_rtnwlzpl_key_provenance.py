"""key-provenance

Revision ID: 0025_rtnwlzpl
Revises: 0024_pxlonwuw
Create Date: 2026-07-06

Key provenance (ADR 0024, native-analysis-accuracy 08): tracks.key_provenance
("analyzed" | "imported" | "manual"; NULL = unknown, e.g. seeded from file
tags). Backfill where derivable: the Engine bulk sync imports grid+key
together, so a track with an `imported` beatgrid gets "imported"; every other
existing key gets "analyzed" (the lowest saved rung — bulk re-analysis may
replace it). key_analyses is dropped: the native path writes Track.key
directly and returns the detection inline; the side-table opinion rows are
superseded (overwrite, no versioning — same verdict as bpm_analyses in 0024).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0025_rtnwlzpl'
down_revision: Union[str, Sequence[str], None] = '0024_pxlonwuw'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tracks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('key_provenance', sa.String(), nullable=True))

    op.execute(
        "UPDATE tracks SET key_provenance = 'imported' WHERE key IS NOT NULL "
        "AND id IN (SELECT track_id FROM beatgrids WHERE origin = 'imported')"
    )
    op.execute(
        "UPDATE tracks SET key_provenance = 'analyzed' WHERE key IS NOT NULL "
        "AND key_provenance IS NULL"
    )

    with op.batch_alter_table('key_analyses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_key_analyses_track_id'))
        batch_op.drop_index(batch_op.f('ix_key_analyses_id'))
    op.drop_table('key_analyses')


def downgrade() -> None:
    op.create_table(
        'key_analyses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('track_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('musical', sa.String(), nullable=False),
        sa.Column('openkey', sa.String(), nullable=True),
        sa.Column('camelot', sa.String(), nullable=True),
        sa.Column('engine_id', sa.Integer(), nullable=True),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('scale', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['track_id'], ['tracks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('key_analyses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_key_analyses_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_key_analyses_track_id'), ['track_id'], unique=True)

    with op.batch_alter_table('tracks', schema=None) as batch_op:
        batch_op.drop_column('key_provenance')

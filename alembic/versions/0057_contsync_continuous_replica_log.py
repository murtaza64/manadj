"""Durable own-device continuous operation log, cursor and causal heads."""
from alembic import op
import sqlalchemy as sa
revision = '0057_contsync'
down_revision = '0056_mwrvn'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('continuous_sync_operations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.String(36), nullable=False),
        sa.Column('origin_id', sa.String(36), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False),
        sa.Column('sha256', sa.String(64), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('signature', sa.String(88), nullable=False),
        sa.Column('state', sa.String(40), nullable=False),
        sa.UniqueConstraint('group_id', 'origin_id', 'sequence'),
        sa.UniqueConstraint('group_id', 'operation_id'), sqlite_autoincrement=True)
    op.create_table('continuous_sync_relay_checkpoints',
        sa.Column('group_id', sa.String(36), primary_key=True),
        sa.Column('origin_id', sa.String(36), primary_key=True),
        sa.Column('sequence', sa.Integer(), nullable=False))
    op.create_table('continuous_sync_cursors',
        sa.Column('group_id', sa.String(36), primary_key=True),
        sa.Column('origin_id', sa.String(36), primary_key=True),
        sa.Column('sequence', sa.Integer(), nullable=False))
    op.create_table('continuous_sync_heads',
        sa.Column('group_id', sa.String(36), primary_key=True),
        sa.Column('entity', sa.String(120), primary_key=True),
        sa.Column('field', sa.String(40), primary_key=True),
        sa.Column('heads_json', sa.Text(), nullable=False))
    op.create_table('continuous_sync_capture_state',
        sa.Column('group_id', sa.String(36), primary_key=True),
        sa.Column('entity', sa.String(120), primary_key=True),
        sa.Column('field', sa.String(40), primary_key=True),
        sa.Column('value_json', sa.Text(), nullable=False))
    op.create_table('continuous_sync_session_owners',
        sa.Column('group_id', sa.String(36), primary_key=True),
        sa.Column('session_uuid', sa.String(36), primary_key=True),
        sa.Column('origin_id', sa.String(36), nullable=False))


def downgrade():
    for table in ('continuous_sync_relay_checkpoints', 'continuous_sync_capture_state', 'continuous_sync_session_owners', 'continuous_sync_heads',
                  'continuous_sync_cursors', 'continuous_sync_operations'):
        op.drop_table(table)

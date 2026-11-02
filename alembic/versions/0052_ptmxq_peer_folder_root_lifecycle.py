"""peer_folder_root_lifecycle

Revision ID: 0052_ptmxq
Revises: 0051_pqtxo
Create Date: 2026-11-02 03:50:11.256297

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0052_ptmxq'
down_revision: Union[str, Sequence[str], None] = '0051_pqtxo'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('peer_folder_roots',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('root', sa.Text(), nullable=False, unique=True),
        sa.Column('token', sa.String(32), nullable=False, unique=True),
        sa.Column('archived', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cursor', sa.String(160), nullable=False, server_default=''),
        sa.Column('last_success', sa.String(40)),
        sa.Column('entries', sa.Integer()))
    op.execute("INSERT INTO peer_folder_roots (id, root, token, cursor) SELECT 1, root, token, cursor FROM peer_folder_config")
    # Pre-configuration selections were allowed by #450. Retain, never auto-export.
    op.execute("""INSERT INTO peer_folder_roots (id, root, token, archived)
        SELECT 1, 'legacy-unassigned', '00000000000000000000000000000000', 1
        WHERE NOT EXISTS (SELECT 1 FROM peer_folder_roots)
        AND EXISTS (SELECT 1 FROM peer_folder_publications)""")
    with op.batch_alter_table('peer_folder_config') as batch:
        batch.add_column(sa.Column('root_id', sa.Integer(), nullable=False, server_default='1'))
        batch.create_foreign_key('fk_folder_config_root', 'peer_folder_roots', ['root_id'], ['id'])
    _scope_table('peer_folder_publications', 'session_uuid', True)
    _scope_table('peer_folder_receipts', 'artifact', True)


def _scope_table(table, key, scoped):
    columns = [sa.Column(key, sa.String(36 if key == 'session_uuid' else 160), primary_key=True)]
    if key == 'session_uuid':
        columns += [sa.Column('published', sa.Integer(), nullable=False), sa.Column('state', sa.String(80), nullable=False)]
        columns[0] = sa.Column(key, sa.String(36), sa.ForeignKey('peer_sync_sessions.session_uuid'), primary_key=True)
    else:
        columns += [sa.Column('received', sa.Integer(), nullable=False), sa.Column('state', sa.String(80), nullable=False),
                    sa.Column('readiness', sa.String(80))]
    if scoped:
        columns.insert(0, sa.Column('root_id', sa.Integer(), sa.ForeignKey('peer_folder_roots.id'), primary_key=True))
    temp = table + '_replacement'
    op.create_table(temp, *columns)
    names = ', '.join(c.name for c in columns)
    source = names.replace('root_id', '1') if scoped else names
    op.execute(sa.text(f'INSERT INTO {temp} ({names}) SELECT {source} FROM {table}'))
    op.drop_table(table)
    op.rename_table(temp, table)


def downgrade() -> None:
    if op.get_bind().scalar(sa.text('SELECT count(*) FROM peer_folder_roots')) > 1:
        raise RuntimeError('Cannot downgrade multiple retained roots without losing provenance')
    for table, key in [('peer_folder_publications', 'session_uuid'), ('peer_folder_receipts', 'artifact')]:
        _scope_table(table, key, False)
    with op.batch_alter_table('peer_folder_config') as batch:
        batch.drop_constraint('fk_folder_config_root', type_='foreignkey')
        batch.drop_column('root_id')
    op.drop_table('peer_folder_roots')

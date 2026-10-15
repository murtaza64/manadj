"""sessions origin (#395: phone-recorded Sessions)

Revision ID: 0046_yumpp
Revises: 0045_yvpon
Create Date: 2026-10-15 03:36:56.072178

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0046_yumpp'
down_revision: Union[str, Sequence[str], None] = '0045_yvpon'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Where a Session was recorded: null = this desktop, else the device name (#395)."""
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("origin", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("origin")

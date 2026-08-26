"""cameos: Cameo artifact, Take verdict columns, Set entry Cameo pins

Cameos PRD tracer (#140): the `cameos` table (Transition storage pattern,
ADR 0011 — host/guest refs, pair-scoped uuid, opaque payload); `takes`
gains the survivor-rule verdict `kind` ("handover" | "guest" — a guest
row IS a Cameo Take) and `engagement_uuid` (one engagement's pairwise
offspring group by it); `set_cameo_pins` holds Set entries' manual Cameo
pins (active + dormant, keyed on host track per Set).

Revision ID: 0035_roxqp
Revises: 0034_wqtstkrm
Create Date: 2026-08-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0035_roxqp'
down_revision: Union[str, Sequence[str], None] = '0034_wqtstkrm'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cameos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("host_track_id", sa.Integer(), nullable=False),
        sa.Column("guest_track_id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("favorite", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("data_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["host_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_cameos_host", "cameos", ["host_track_id"])
    op.create_index("idx_cameos_guest", "cameos", ["guest_track_id"])
    op.create_index(
        "idx_cameos_pair_uuid",
        "cameos",
        ["host_track_id", "guest_track_id", "uuid"],
        unique=True,
    )

    # Survivor-rule verdict + engagement identity on takes (#140).
    # server_default backfills every pre-#140 row as a Handover.
    op.add_column(
        "takes",
        sa.Column("kind", sa.String(), nullable=False, server_default="handover"),
    )
    op.add_column("takes", sa.Column("engagement_uuid", sa.String(), nullable=True))
    op.create_index("idx_takes_engagement", "takes", ["engagement_uuid"])

    op.create_table(
        "set_cameo_pins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("host_track_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("pin_kind", sa.String(), nullable=False),
        sa.Column("pin_uuid", sa.String(), nullable=False),
        sa.Column("dormant", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["host_track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_set_cameo_pins_set", "set_cameo_pins", ["set_id"])
    op.create_index("idx_set_cameo_pins_host", "set_cameo_pins", ["set_id", "host_track_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_set_cameo_pins_host", table_name="set_cameo_pins")
    op.drop_index("idx_set_cameo_pins_set", table_name="set_cameo_pins")
    op.drop_table("set_cameo_pins")
    op.drop_index("idx_takes_engagement", table_name="takes")
    op.drop_column("takes", "engagement_uuid")
    op.drop_column("takes", "kind")
    op.drop_index("idx_cameos_pair_uuid", table_name="cameos")
    op.drop_index("idx_cameos_guest", table_name="cameos")
    op.drop_index("idx_cameos_host", table_name="cameos")
    op.drop_table("cameos")

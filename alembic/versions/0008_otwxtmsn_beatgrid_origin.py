"""beatgrid origin

Revision ID: 0008_otwxtmsn
Revises: 0007_luvzkmyz
Create Date: 2026-07-04

Adds beatgrids.origin ("generated" | "edited" | "imported"). Existing rows
are backfilled once via the old structural heuristic: a single tempo change
at t=0 with the track's own BPM is a generated placeholder; anything else
is treated as edited (saved info — the safe direction).
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0008_otwxtmsn'
down_revision: Union[str, Sequence[str], None] = '0007_luvzkmyz'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_auto_generated(tempo_changes: list[dict], track_bpm_centi: int | None) -> bool:
    if track_bpm_centi is None or len(tempo_changes) != 1:
        return False
    tc = tempo_changes[0]
    return (
        tc.get("start_time") == 0.0
        and tc.get("bar_position") == 1
        and abs(tc.get("bpm", 0.0) - track_bpm_centi / 100.0) < 0.005
    )


def upgrade() -> None:
    op.add_column(
        "beatgrids",
        sa.Column("origin", sa.String(), nullable=False, server_default="edited"),
    )

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT b.id, b.tempo_changes_json, t.bpm"
            " FROM beatgrids b JOIN tracks t ON t.id = b.track_id"
        )
    ).fetchall()
    for beatgrid_id, tempo_changes_json, bpm in rows:
        try:
            tempo_changes = json.loads(tempo_changes_json)
        except (TypeError, ValueError):
            continue  # unparseable -> keep "edited" (protected)
        if _is_auto_generated(tempo_changes, bpm):
            connection.execute(
                sa.text("UPDATE beatgrids SET origin = 'generated' WHERE id = :id"),
                {"id": beatgrid_id},
            )


def downgrade() -> None:
    op.drop_column("beatgrids", "origin")

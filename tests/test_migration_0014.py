"""Migration 0014 (mix-editor issue 28): the anchor-model column swap
converts existing template rows EXACTLY. At the old window start B's
track position was `baseB + dB`, so B's bare anchor (the new reference)
sits −dB beats after the window start:
    align_delta_beats = dA - dB
    before_beats      = -dB
    after_beats       = length_beats + dB
"""

from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


def test_0014_converts_old_template_rows_exactly():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False

        # Build the OLD schema and insert an issue-03-era row: the PRD's
        # worked example — drop alignment with a 32-beat lead-in was
        # alignA(cue4, +32), alignB(cue4, −32), length 64.
        alembic_command.upgrade(cfg, "0013_rqwtvtsu")
        connection.execute(
            text(
                "INSERT INTO transition_templates "
                "(uuid, name, align_a_base, align_a_delta_beats, align_b_base, "
                " align_b_delta_beats, length_beats, scalable, lanes_json) "
                "VALUES ('t1', 'bass swap', 'cue_4', 32, 'cue_4', -32, 64, 1, '{}')"
            )
        )
        connection.commit()

        alembic_command.upgrade(cfg, "head")

        row = connection.execute(
            text(
                "SELECT align_a_base, align_delta_beats, align_b_base, "
                "before_beats, after_beats, scalable, lanes_json "
                "FROM transition_templates WHERE uuid = 't1'"
            )
        ).one()
        # The old "drop alignment with 32-beat lead-in" reads, in new
        # coordinates, exactly as the move is thought: B's drop lands on
        # A's cue4 + 64 (the phrase offset), window 32 before / 32 after.
        assert row.align_a_base == "cue_4"
        assert row.align_delta_beats == 64  # dA − dB = 32 − (−32)
        assert row.align_b_base == "cue_4"
        assert row.before_beats == 32  # −dB
        assert row.after_beats == 32  # length + dB
        assert row.before_beats + row.after_beats == 64  # length preserved
        assert row.scalable == 1
        assert row.lanes_json == "{}"
    engine.dispose()

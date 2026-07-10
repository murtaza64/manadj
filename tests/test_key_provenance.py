"""Key provenance and native key Analysis (ADR 0024, native-analysis-accuracy 08).

Keys gain provenance: "analyzed" (native Analysis), "imported" (External
Import), "manual" (direct user edit); NULL = unknown (e.g. seeded from file
tags — ranks below everything, freely overwritable). Behavior tests at the
analysis seam use a stubbed key candidate — no real audio analysis.
"""

import json

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend import key_analysis
from backend.database import get_db
from backend.key import Key
from backend.key_analysis import analyze_track_key
from backend.models import Track
from backend.sync_performance import EnginePerformanceFields
from backend.track_metadata import apply_update
from backend.track_metadata.models import TrackChanges

from .conftest import ALEMBIC_INI


class StubKeyCandidate:
    """A key detector fake: canned Key, no audio."""

    name = "stub-key"

    def __init__(self, key: Key | None, confidence: float | None = 0.9):
        self._key = key
        self._confidence = confidence

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        return self._key, self._confidence


AM = Key.from_musical("Am")
F_SHARP_M = Key.from_musical("F#m")


class TestAnalyzeTrackKey:
    def test_detection_writes_key_with_analyzed_provenance(self, db, make_track):
        track = make_track(key=None)
        detected, confidence = analyze_track_key(db, track, StubKeyCandidate(AM))

        assert detected == AM
        assert confidence == 0.9
        assert track.key == AM.engine_id
        assert track.key_provenance == "analyzed"

    def test_undetected_writes_nothing(self, db, make_track):
        track = make_track(key=F_SHARP_M.engine_id)
        track.key_provenance = "manual"
        db.commit()

        detected, confidence = analyze_track_key(
            db, track, StubKeyCandidate(None, None)
        )

        assert detected is None
        assert track.key == F_SHARP_M.engine_id
        assert track.key_provenance == "manual"

    def test_reanalysis_overwrites(self, db, make_track):
        """The seam overwrites freely — precedence protection is the bulk
        runner's job (issue 09)."""
        track = make_track(key=AM.engine_id)
        track.key_provenance = "manual"
        db.commit()

        analyze_track_key(db, track, StubKeyCandidate(F_SHARP_M))

        assert track.key == F_SHARP_M.engine_id
        assert track.key_provenance == "analyzed"


class TestManualEditProvenance:
    def test_user_key_edit_is_manual(self, db, make_track):
        track = make_track(key=None)
        apply_update(db, track, TrackChanges(key=AM.engine_id), write_files=False)

        assert track.key == AM.engine_id
        assert track.key_provenance == "manual"

    def test_unrelated_edit_leaves_provenance(self, db, make_track):
        track = make_track(key=AM.engine_id)
        track.key_provenance = "analyzed"
        db.commit()

        apply_update(db, track, TrackChanges(title="New Title"), write_files=False)

        assert track.key_provenance == "analyzed"


class TestImportProvenance:
    @pytest.fixture
    def make_client(self, db: Session):
        from backend.routers import sync_performance

        class FakeSource:
            def __init__(self, by_filename):
                self._by_filename = by_filename

            def fields_for(self, filename: str):
                return self._by_filename.get(filename)

        def _make(by_filename) -> TestClient:
            app = FastAPI()
            app.include_router(sync_performance.router, prefix="/api")
            app.dependency_overrides[get_db] = lambda: db
            app.dependency_overrides[
                sync_performance.get_engine_performance_source
            ] = lambda: FakeSource(by_filename)
            return TestClient(app)

        return _make

    def test_engine_fill_empty_key_is_imported(self, db, make_track, make_client):
        track = make_track(filename="/m/a.mp3", key=None)
        client = make_client({"/m/a.mp3": EnginePerformanceFields(hotcues=[], beatgrid=None, maincue=None, key=7)})

        resp = client.post(
            "/api/sync/performance/bulk-import", json={"track_ids": [track.id]}
        )
        assert resp.status_code == 200
        assert resp.json()["applied"]["key"] == 1

        db.expire_all()
        row = db.query(Track).filter_by(id=track.id).one()
        assert row.key == 7
        assert row.key_provenance == "imported"

    def test_engine_authorized_overwrite_is_imported(self, db, make_track, make_client):
        track = make_track(filename="/m/a.mp3", key=3)
        track.key_provenance = "analyzed"
        db.commit()
        client = make_client({"/m/a.mp3": EnginePerformanceFields(hotcues=[], beatgrid=None, maincue=None, key=7)})

        resp = client.post(
            "/api/sync/performance/bulk-import",
            json={
                "track_ids": [track.id],
                "overwrites": [{"track_id": track.id, "field": "key"}],
            },
        )
        assert resp.status_code == 200

        db.expire_all()
        row = db.query(Track).filter_by(id=track.id).one()
        assert row.key == 7
        assert row.key_provenance == "imported"


# The manual key path no longer has its own synchronous endpoint: the Analyze
# button enqueues one `manual` grid+key task (task-system 01). The endpoint's
# enqueue/observe behavior is covered by TestAnalyzeEndpoint in
# test_grid_analysis.py; the key-writing behavior a manual task performs is the
# analyze_track_key seam above (TestAnalyzeTrackKey) plus the task handler
# (test_analysis_tasks.py).


def test_default_key_candidate_is_the_shootout_winner():
    """Issue 06 winner: madmom_keycnn. Constructing it must not import
    madmom (heavy deps live inside key() only — see test_import_hygiene)."""
    candidate = key_analysis.default_key_candidate()
    assert candidate.name == "madmom_keycnn"


def test_migration_backfills_provenance():
    """Existing keys: Engine-imported where derivable — the Engine bulk sync
    imports grid+key together, so an `imported` beatgrid marks the track —
    else `analyzed`. NULL keys stay NULL provenance."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    grid_json = json.dumps(
        [{"start_time": 0.0, "bpm": 128.0, "time_signature_num": 4,
          "time_signature_den": 4, "bar_position": 1}]
    )

    with engine.connect() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False
        alembic_command.upgrade(cfg, "0024_pxlonwuw")

        connection.execute(text(
            "INSERT INTO tracks (id, filename, key) VALUES"
            " (1, '/t/a.mp3', 7),"   # imported grid -> imported
            " (2, '/t/b.mp3', 3),"   # no grid -> analyzed
            " (3, '/t/c.mp3', NULL)"  # no key -> NULL
        ))
        connection.execute(
            text(
                "INSERT INTO beatgrids (track_id, tempo_changes_json, origin)"
                " VALUES (1, :tcj, 'imported')"
            ),
            {"tcj": grid_json},
        )
        connection.commit()

        alembic_command.upgrade(cfg, "head")

        rows = dict(connection.execute(
            text("SELECT id, key_provenance FROM tracks")
        ).fetchall())

    assert rows == {1: "imported", 2: "analyzed", 3: None}

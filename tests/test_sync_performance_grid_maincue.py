"""Beatgrid + Main cue as Diverged fields + Engine → Library import.

Aggregator semantics with fake SurfaceReaders; import through the router
seam. Placeholder grids (origin "generated") compare as absent; only
Engine main cues with the overridden flag participate (enforced at the
source — here the fakes just carry values or None).
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, Track, Waveform
from backend.sync_status import (
    BeatgridValue,
    SurfaceTrackRef,
    TempoChangeValue,
    TrackFields,
    compute_sync_status,
)

PERF_FIELDS = frozenset({"beatgrid", "maincue"})


class FakeSurfaceReader:
    def __init__(self, refs: list[SurfaceTrackRef], fields: frozenset[str] = PERF_FIELDS):
        self._refs = refs
        self.fields = fields

    def list_tracks(self) -> list[SurfaceTrackRef]:
        return self._refs


def engine_surface(path: str, *, beatgrid: BeatgridValue | None = None,
                   maincue: float | None = None) -> dict:
    return {"engine": FakeSurfaceReader([
        SurfaceTrackRef(path=path, fields=TrackFields(beatgrid=beatgrid, maincue=maincue))
    ])}


def grid(*changes: tuple[float, float]) -> BeatgridValue:
    return BeatgridValue(tempo_changes=[
        TempoChangeValue(start_time=t, bpm=bpm) for t, bpm in changes
    ])


def tempo_changes_json(*changes: tuple[float, float]) -> str:
    return json.dumps([
        {"start_time": t, "bpm": bpm, "time_signature_num": 4,
         "time_signature_den": 4, "bar_position": 1}
        for t, bpm in changes
    ])


def add_grid(db: Session, track_id: int, origin: str, *changes: tuple[float, float]) -> None:
    db.add(Beatgrid(track_id=track_id, origin=origin,
                    tempo_changes_json=tempo_changes_json(*changes)))
    db.commit()


def add_waveform(db: Session, track_id: int, cue: float | None = None) -> None:
    """Seed a waveform row; the Main cue lives on the Track (issue 06)."""
    db.add(Waveform(track_id=track_id, sample_rate=44100, duration=180.0,
                    samples_per_peak=1024))
    if cue is not None:
        db.query(Track).filter(Track.id == track_id).update({"cue_point_time": cue})
    db.commit()


def only_row(result):
    assert len(result.rows) == 1
    return result.rows[0]


def divergence(row, field: str):
    hits = [d for d in row.diverged if d.field == field]
    assert len(hits) == 1, f"expected 1 {field} divergence, got {hits}"
    return hits[0]


# ------------------------------------------------------------- beatgrid


class TestBeatgridDivergence:
    def test_identical_grid_in_sync(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.5, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.5, 128.0)))
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_grid_within_epsilon_in_sync(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.5, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.5004, 128.005)))
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_bpm_drift_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.5, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.5, 128.2)))
        row = only_row(compute_sync_status(db, s))
        d = divergence(row, "beatgrid")
        assert d.no_overwrite is False
        assert d.importable_from == ["engine"]

    def test_offset_drift_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.5, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.6, 128.0)))
        assert only_row(compute_sync_status(db, s)).status == "diverged"

    def test_tempo_change_count_difference_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.5, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.5, 128.0), (60.0, 130.0)))
        row = only_row(compute_sync_status(db, s))
        d = divergence(row, "beatgrid")
        engine_value = d.surface_values["engine"]
        assert len(engine_value.tempo_changes) == 2  # variable flag = len > 1

    def test_placeholder_grid_reads_as_absent(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "generated", (0.0, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.5, 128.0)))
        row = only_row(compute_sync_status(db, s))
        d = divergence(row, "beatgrid")
        assert d.no_overwrite is True  # library side counts as empty
        assert d.library_value is None

    def test_no_grid_row_reads_as_absent(self, db, make_track):
        make_track(filename="/m/a.mp3")
        s = engine_surface("/m/a.mp3", beatgrid=grid((0.5, 128.0)))
        d = divergence(only_row(compute_sync_status(db, s)), "beatgrid")
        assert d.no_overwrite is True

    def test_engine_without_grid_is_not_a_divergence(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.5, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=None)
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_placeholder_vs_engine_absent_in_sync(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "generated", (0.0, 128.0))
        s = engine_surface("/m/a.mp3", beatgrid=None)
        assert only_row(compute_sync_status(db, s)).status == "in-sync"


# ------------------------------------------------------------- main cue


class TestMainCueDivergence:
    def test_equal_within_tolerance_in_sync(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=15.0)
        s = engine_surface("/m/a.mp3", maincue=15.0005)
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_different_positions_diverge(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=15.0)
        s = engine_surface("/m/a.mp3", maincue=32.0)
        d = divergence(only_row(compute_sync_status(db, s)), "maincue")
        assert d.no_overwrite is False
        assert d.importable_from == ["engine"]

    def test_library_unset_engine_set(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=None)
        s = engine_surface("/m/a.mp3", maincue=32.0)
        d = divergence(only_row(compute_sync_status(db, s)), "maincue")
        assert d.no_overwrite is True  # fill-empty case

    def test_library_set_engine_unset_is_not_a_divergence(self, db, make_track):
        # Engine None = not overridden there — nothing to compare, not a conflict
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=15.0)
        s = engine_surface("/m/a.mp3", maincue=None)
        assert only_row(compute_sync_status(db, s)).status == "in-sync"


# ------------------------------------------------------------- import


class FakePerformanceFields:
    def __init__(self, beatgrid=None, maincue=None, hotcues=None):
        self.beatgrid = beatgrid
        self.maincue = maincue
        self.hotcues = hotcues


class FakeEnginePerformanceSource:
    def __init__(self, by_filename: dict[str, FakePerformanceFields]):
        self._by_filename = by_filename

    def fields_for(self, filename: str):
        return self._by_filename.get(filename)


@pytest.fixture
def make_client(db: Session):
    from backend.routers import sync_performance

    def _make(source: FakeEnginePerformanceSource) -> TestClient:
        app = FastAPI()
        app.include_router(sync_performance.router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[sync_performance.get_engine_performance_source] = lambda: source
        return TestClient(app)

    return _make


def db_grid(db: Session, track_id: int) -> Beatgrid | None:
    return db.query(Beatgrid).filter(Beatgrid.track_id == track_id).first()


ENGINE_GRID = grid((0.5, 128.0))
VARIABLE_GRID = grid((0.5, 128.0), (60.0, 130.0), (120.0, 129.5))


class TestBeatgridImport:
    def test_fill_empty_onto_placeholder(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "generated", (0.0, 128.0))
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(beatgrid=ENGINE_GRID)}))
        resp = client.post("/api/sync/performance/beatgrid/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 200
        assert resp.json()["imported"] is True
        bg = db_grid(db, t.id)
        assert bg.origin == "imported"
        assert json.loads(bg.tempo_changes_json)[0]["start_time"] == 0.5

    def test_fill_empty_never_touches_saved_grid(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.35, 127.5))
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(beatgrid=ENGINE_GRID)}))
        resp = client.post("/api/sync/performance/beatgrid/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 200
        assert resp.json()["imported"] is False
        bg = db_grid(db, t.id)
        assert bg.origin == "edited"
        assert json.loads(bg.tempo_changes_json)[0]["start_time"] == 0.35

    def test_replace_overwrites_saved_grid(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_grid(db, t.id, "edited", (0.35, 127.5))
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(beatgrid=ENGINE_GRID)}))
        resp = client.post("/api/sync/performance/beatgrid/import",
                           json={"track_id": t.id, "mode": "replace"})
        assert resp.json()["imported"] is True
        bg = db_grid(db, t.id)
        assert bg.origin == "imported"
        assert json.loads(bg.tempo_changes_json)[0]["bpm"] == 128.0

    def test_variable_grid_imports_all_tempo_changes(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(beatgrid=VARIABLE_GRID)}))
        resp = client.post("/api/sync/performance/beatgrid/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.json()["imported"] is True
        changes = json.loads(db_grid(db, t.id).tempo_changes_json)
        assert [c["bpm"] for c in changes] == [128.0, 130.0, 129.5]

    def test_later_edit_flips_imported_to_edited(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3", bpm=12800)
        add_waveform(db, t.id)
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(beatgrid=ENGINE_GRID)}))
        client.post("/api/sync/performance/beatgrid/import",
                    json={"track_id": t.id, "mode": "fill-empty"})
        from backend import crud
        crud.update_beatgrid_tempo_changes(db, t.id, json.loads(tempo_changes_json((0.6, 128.0))))
        assert db_grid(db, t.id).origin == "edited"

    def test_no_engine_grid_404(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(beatgrid=None)}))
        resp = client.post("/api/sync/performance/beatgrid/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 404


class TestMainCueImport:
    def test_fill_empty_when_unset(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=None)
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(maincue=32.125)}))
        resp = client.post("/api/sync/performance/maincue/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 200
        assert resp.json()["imported"] is True
        db.expire_all()
        assert db.query(Track).filter(Track.id == t.id).one().cue_point_time == 32.125

    def test_fill_empty_never_touches_saved_cue(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=15.0)
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(maincue=32.125)}))
        resp = client.post("/api/sync/performance/maincue/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.json()["imported"] is False
        db.expire_all()
        assert db.query(Track).filter(Track.id == t.id).one().cue_point_time == 15.0

    def test_replace_overwrites_saved_cue(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id, cue=15.0)
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(maincue=32.125)}))
        resp = client.post("/api/sync/performance/maincue/import",
                           json={"track_id": t.id, "mode": "replace"})
        assert resp.json()["imported"] is True
        db.expire_all()
        assert db.query(Track).filter(Track.id == t.id).one().cue_point_time == 32.125

    def test_import_without_waveform_row_succeeds(self, db, make_track, make_client):
        # The Main cue lives on the Track (issue 06): a missing waveform row
        # no longer blocks the import (previously a 409).
        t = make_track(filename="/m/a.mp3")
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(maincue=32.125)}))
        resp = client.post("/api/sync/performance/maincue/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 200
        db.expire_all()
        assert db.query(Track).filter(Track.id == t.id).one().cue_point_time == 32.125

    def test_engine_cue_not_overridden_404(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_waveform(db, t.id)
        client = make_client(FakeEnginePerformanceSource(
            {"/m/a.mp3": FakePerformanceFields(maincue=None)}))
        resp = client.post("/api/sync/performance/maincue/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 404


# --------------------------------------------------- blob → grid conversion


class TestGridFromBlobs:
    def test_constant_grid_from_blob(self):
        from backend.sync_performance import performance_fields_from_blobs
        from tests.test_engine_performance_blobs import (
            CONSTANT_GRID,
            EMPTY_SLOT,
            build_beat_blob,
            build_quick_cues_blob,
        )

        fields = performance_fields_from_blobs(
            build_beat_blob(adjusted_grid=CONSTANT_GRID),
            build_quick_cues_blob([EMPTY_SLOT] * 8),
        )
        assert fields is not None
        assert fields.beatgrid is not None
        [tc] = fields.beatgrid.tempo_changes
        # The grid starts at the first *beat* at t >= 0 (script-era math):
        # beat 0 is at 0.5s, so beat -1 sits one beat earlier at 128 BPM,
        # carrying bar position 4.
        assert tc.start_time == pytest.approx(0.5 - 60.0 / 128.0)
        assert tc.bpm == pytest.approx(128.0, abs=0.001)
        assert tc.bar_position == 4

    def test_maincue_only_when_overridden(self):
        from backend.sync_performance import performance_fields_from_blobs
        from tests.test_engine_performance_blobs import (
            CONSTANT_GRID,
            EMPTY_SLOT,
            build_beat_blob,
            build_quick_cues_blob,
        )

        beat = build_beat_blob(adjusted_grid=CONSTANT_GRID)
        overridden = performance_fields_from_blobs(
            beat, build_quick_cues_blob([EMPTY_SLOT] * 8, main_cue_samples=44100.0 * 15,
                                        overridden=True))
        default = performance_fields_from_blobs(
            beat, build_quick_cues_blob([EMPTY_SLOT] * 8, main_cue_samples=44100.0 * 15,
                                        overridden=False))
        assert overridden.maincue == pytest.approx(15.0)
        assert default.maincue is None

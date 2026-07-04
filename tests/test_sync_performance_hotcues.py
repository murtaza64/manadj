"""Hot Cues as a Diverged field + Engine → Library import (per-cell verbs).

Aggregator semantics through compute_sync_status with fake SurfaceReaders
(prior art: test_sync_status.py); import behavior through the router seam
(prior art: test_beatgrid_origin.py). Imported cues are Engine ground truth:
never quantized, exact positions preserved.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, HotCue, Waveform
from backend.sync_status import (
    HotCueValue,
    SurfaceTrackRef,
    TrackFields,
    compute_sync_status,
)

# These tests isolate the hotcues field: the fake surface declares only it,
# so scalar/tags comparison (covered by test_sync_status.py) stays out of
# the picture.
HOTCUES_ONLY = frozenset({"hotcues"})


class FakeSurfaceReader:
    def __init__(self, refs: list[SurfaceTrackRef], fields: frozenset[str] = HOTCUES_ONLY):
        self._refs = refs
        self.fields = fields

    def list_tracks(self) -> list[SurfaceTrackRef]:
        return self._refs


def cue(slot: int, time: float, label: str | None = None, color: str | None = None) -> HotCueValue:
    return HotCueValue(slot=slot, time=time, label=label, color=color)


def engine_surface(path: str, hotcues: list[HotCueValue] | None) -> dict:
    return {"engine": FakeSurfaceReader([
        SurfaceTrackRef(path=path, fields=TrackFields(hotcues=hotcues))
    ])}


def add_cue(db: Session, track_id: int, slot: int, time: float,
            label: str | None = None, color: str | None = None) -> None:
    db.add(HotCue(track_id=track_id, slot_number=slot, time_seconds=time,
                  label=label, color=color))
    db.commit()


def only_row(result):
    assert len(result.rows) == 1
    return result.rows[0]


def divergence(row, field: str):
    hits = [d for d in row.diverged if d.field == field]
    assert len(hits) == 1, f"expected 1 {field} divergence, got {len(hits)}"
    return hits[0]


# ------------------------------------------------------------- comparison


class TestHotCueDivergence:
    def test_identical_sets_in_sync(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0, "Drop", "#FF0080")
        s = engine_surface("/m/a.mp3", [cue(1, 30.0, "Drop", "#FF0080")])
        row = only_row(compute_sync_status(db, s))
        assert row.status == "in-sync"

    def test_time_within_tolerance_is_equal(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0)
        s = engine_surface("/m/a.mp3", [cue(1, 30.0005)])
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_time_beyond_tolerance_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0)
        s = engine_surface("/m/a.mp3", [cue(1, 30.01)])
        row = only_row(compute_sync_status(db, s))
        assert row.status == "diverged"
        d = divergence(row, "hotcues")
        assert d.importable_from == ["engine"]
        assert d.no_overwrite is False

    def test_label_difference_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0, label="Drop")
        s = engine_surface("/m/a.mp3", [cue(1, 30.0, label="Break")])
        assert only_row(compute_sync_status(db, s)).status == "diverged"

    def test_empty_label_equals_none(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0, label=None)
        s = engine_surface("/m/a.mp3", [cue(1, 30.0, label="")])
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_color_difference_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0, color="#FF0080")
        s = engine_surface("/m/a.mp3", [cue(1, 30.0, color="#00FF00")])
        assert only_row(compute_sync_status(db, s)).status == "diverged"

    def test_color_comparison_case_insensitive(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0, color="#ff0080")
        s = engine_surface("/m/a.mp3", [cue(1, 30.0, color="#FF0080")])
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_slot_occupancy_difference_diverges(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0)
        s = engine_surface("/m/a.mp3", [cue(1, 30.0), cue(2, 60.0)])
        assert only_row(compute_sync_status(db, s)).status == "diverged"

    def test_library_empty_engine_has_cues(self, db, make_track):
        make_track(filename="/m/a.mp3")
        s = engine_surface("/m/a.mp3", [cue(1, 30.0)])
        row = only_row(compute_sync_status(db, s))
        d = divergence(row, "hotcues")
        assert d.no_overwrite is True  # fill-empty case
        assert d.importable_from == ["engine"]

    def test_engine_carries_no_performance_data_for_track(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0)
        s = engine_surface("/m/a.mp3", None)  # blob missing/unparseable
        assert only_row(compute_sync_status(db, s)).status == "in-sync"

    def test_engine_empty_set_not_importable(self, db, make_track):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 30.0)
        s = engine_surface("/m/a.mp3", [])
        row = only_row(compute_sync_status(db, s))
        d = divergence(row, "hotcues")
        assert d.importable_from == []


# ------------------------------------------------------------- import


class FakeEnginePerformanceSource:
    def __init__(self, hotcues_by_filename: dict[str, list[HotCueValue] | None]):
        self._by_filename = hotcues_by_filename

    def fields_for(self, filename: str):
        from backend.sync_performance import EnginePerformanceFields

        cues = self._by_filename.get(filename)
        if cues is None:
            return None
        return EnginePerformanceFields(hotcues=cues, beatgrid=None, maincue=None)


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


def db_cues(db: Session, track_id: int) -> dict[int, tuple[float, str | None, str | None]]:
    rows = db.query(HotCue).filter(HotCue.track_id == track_id).all()
    return {r.slot_number: (r.time_seconds, r.label, r.color) for r in rows}


ENGINE_CUES = [cue(1, 30.1234567, "Drop", "#FF0080"), cue(3, 90.5, None, "#00FF00")]


class TestHotCueImport:
    def test_fill_empty_imports_all_when_library_empty(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_CUES}))
        resp = client.post("/api/sync/performance/hotcues/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 200
        assert resp.json()["imported"] == 2
        cues = db_cues(db, t.id)
        assert cues[1] == (30.1234567, "Drop", "#FF0080")  # exact, unquantized
        assert cues[3] == (90.5, None, "#00FF00")

    def test_fill_empty_never_touches_existing_slots(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 11.0, "Mine", "#111111")
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_CUES}))
        resp = client.post("/api/sync/performance/hotcues/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 1 and body["skipped"] == 1
        cues = db_cues(db, t.id)
        assert cues[1] == (11.0, "Mine", "#111111")  # preserved
        assert cues[3] == (90.5, None, "#00FF00")

    def test_replace_all_takes_engine_set_wholesale(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        add_cue(db, t.id, 1, 11.0, "Mine")
        add_cue(db, t.id, 5, 55.0, "OnlyInLibrary")
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_CUES}))
        resp = client.post("/api/sync/performance/hotcues/import",
                           json={"track_id": t.id, "mode": "replace-all"})
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2
        cues = db_cues(db, t.id)
        assert set(cues) == {1, 3}
        assert cues[1] == (30.1234567, "Drop", "#FF0080")

    def test_import_bypasses_beat_quantization(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3", bpm=12800)
        db.add(Waveform(track_id=t.id, sample_rate=44100, duration=180.0,
                        samples_per_peak=1024, low_peaks_json="[]",
                        mid_peaks_json="[]", high_peaks_json="[]"))
        db.add(Beatgrid(track_id=t.id, origin="edited", tempo_changes_json=json.dumps([{
            "start_time": 0.0, "bpm": 128.0, "time_signature_num": 4,
            "time_signature_den": 4, "bar_position": 1,
        }])))
        db.commit()
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_CUES}))
        client.post("/api/sync/performance/hotcues/import",
                    json={"track_id": t.id, "mode": "fill-empty"})
        assert db_cues(db, t.id)[1][0] == 30.1234567  # not snapped to the grid

    def test_reimport_is_a_noop(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_CUES}))
        client.post("/api/sync/performance/hotcues/import",
                    json={"track_id": t.id, "mode": "fill-empty"})
        resp = client.post("/api/sync/performance/hotcues/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.json()["imported"] == 0
        assert len(db_cues(db, t.id)) == 2

    def test_unknown_track_404(self, db, make_client):
        client = make_client(FakeEnginePerformanceSource({}))
        resp = client.post("/api/sync/performance/hotcues/import",
                           json={"track_id": 999, "mode": "fill-empty"})
        assert resp.status_code == 404

    def test_track_without_engine_cues_404(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        client = make_client(FakeEnginePerformanceSource({}))
        resp = client.post("/api/sync/performance/hotcues/import",
                           json={"track_id": t.id, "mode": "fill-empty"})
        assert resp.status_code == 404

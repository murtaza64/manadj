"""Bulk "import performance data from Engine" — two tiers, no silent
overwrites (PRD). Automatic tier fills blanks (hot cues where none, grid
where absent/placeholder, main cue where unset, key where empty); every
overwrite of saved info comes back as a pending item until explicitly
listed in `overwrites` on a follow-up call.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, HotCue, Track, Waveform
from backend.sync_performance import EnginePerformanceFields
from backend.sync_status import BeatgridValue, HotCueValue, TempoChangeValue


def cue(slot: int, time: float, label: str | None = None, color: str | None = None):
    return HotCueValue(slot=slot, time=time, label=label, color=color)


def grid(*changes: tuple[float, float]) -> BeatgridValue:
    return BeatgridValue(tempo_changes=[
        TempoChangeValue(start_time=t, bpm=bpm) for t, bpm in changes
    ])


ENGINE_FULL = EnginePerformanceFields(
    hotcues=[cue(1, 30.0, "Drop", "#FF0080"), cue(2, 60.0)],
    beatgrid=grid((0.5, 128.0)),
    maincue=15.25,
    key=7,
)


class FakeEnginePerformanceSource:
    def __init__(self, by_filename: dict[str, EnginePerformanceFields]):
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


def add_waveform(db: Session, track_id: int, cue_time: float | None = None) -> None:
    db.add(Waveform(track_id=track_id, sample_rate=44100, duration=180.0,
                    samples_per_peak=1024, low_peaks_json="[]",
                    mid_peaks_json="[]", high_peaks_json="[]",
                    cue_point_time=cue_time))
    db.commit()


def bulk(client, **body):
    resp = client.post("/api/sync/performance/bulk-import", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestAutomaticTier:
    def test_blank_track_gets_everything(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3", key=None)
        add_waveform(db, t.id)
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))

        result = bulk(client, track_ids=[t.id])

        assert result["applied"] == {"hotcues": 1, "beatgrid": 1, "maincue": 1, "key": 1}
        assert result["pending"] == []
        assert db.query(HotCue).filter_by(track_id=t.id).count() == 2
        assert db.query(Beatgrid).filter_by(track_id=t.id).one().origin == "imported"
        assert db.query(Waveform).filter_by(track_id=t.id).one().cue_point_time == 15.25
        db.expire_all()
        assert db.query(Track).get(t.id).key == 7

    def test_placeholder_grid_filled_automatically(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")
        db.add(Beatgrid(track_id=t.id, origin="generated", tempo_changes_json=json.dumps(
            [{"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4,
              "time_signature_den": 4, "bar_position": 1}])))
        db.commit()
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))

        result = bulk(client, track_ids=[t.id])
        assert result["applied"]["beatgrid"] == 1
        assert db.query(Beatgrid).filter_by(track_id=t.id).one().origin == "imported"

    def test_saved_data_untouched_and_pending(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3", key=3)
        add_waveform(db, t.id, cue_time=99.0)
        db.add(HotCue(track_id=t.id, slot_number=1, time_seconds=11.0, label="Mine"))
        db.add(Beatgrid(track_id=t.id, origin="edited", tempo_changes_json=json.dumps(
            [{"start_time": 0.35, "bpm": 127.0, "time_signature_num": 4,
              "time_signature_den": 4, "bar_position": 1}])))
        db.commit()
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))

        result = bulk(client, track_ids=[t.id])

        assert result["applied"] == {"hotcues": 0, "beatgrid": 0, "maincue": 0, "key": 0}
        pending_fields = {p["field"] for p in result["pending"]}
        assert pending_fields == {"hotcues", "beatgrid", "maincue", "key"}
        # nothing changed
        assert db.query(HotCue).filter_by(track_id=t.id).count() == 1
        assert db.query(Beatgrid).filter_by(track_id=t.id).one().origin == "edited"
        assert db.query(Waveform).filter_by(track_id=t.id).one().cue_point_time == 99.0

    def test_in_sync_fields_neither_applied_nor_pending(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3", key=7)
        add_waveform(db, t.id, cue_time=15.25)
        db.add(HotCue(track_id=t.id, slot_number=1, time_seconds=30.0,
                      label="Drop", color="#FF0080"))
        db.add(HotCue(track_id=t.id, slot_number=2, time_seconds=60.0))
        db.add(Beatgrid(track_id=t.id, origin="imported", tempo_changes_json=json.dumps(
            [{"start_time": 0.5, "bpm": 128.0, "time_signature_num": 4,
              "time_signature_den": 4, "bar_position": 1}])))
        db.commit()
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))

        result = bulk(client, track_ids=[t.id])
        assert result["applied"] == {"hotcues": 0, "beatgrid": 0, "maincue": 0, "key": 0}
        assert result["pending"] == []

    def test_maincue_without_waveform_row_reported_not_dropped(self, db, make_track, make_client):
        t = make_track(filename="/m/a.mp3")  # no waveform row
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))
        result = bulk(client, track_ids=[t.id])
        assert result["applied"]["maincue"] == 0
        assert result["maincue_no_waveform"] == 1

    def test_unmatched_tracks_are_skipped(self, db, make_track, make_client):
        t = make_track(filename="/m/nowhere.mp3")
        client = make_client(FakeEnginePerformanceSource({}))
        result = bulk(client, track_ids=[t.id])
        assert result["scanned"] == 1
        assert result["matched"] == 0
        assert result["pending"] == []

    def test_null_track_ids_means_all(self, db, make_track, make_client):
        make_track(filename="/m/a.mp3")
        make_track(filename="/m/b.mp3")
        client = make_client(FakeEnginePerformanceSource({
            "/m/a.mp3": ENGINE_FULL,
            "/m/b.mp3": ENGINE_FULL,
        }))
        result = bulk(client)
        assert result["scanned"] == 2
        assert result["applied"]["hotcues"] == 2

    def test_scoping_only_touches_listed_tracks(self, db, make_track, make_client):
        t1 = make_track(filename="/m/a.mp3")
        t2 = make_track(filename="/m/b.mp3")
        client = make_client(FakeEnginePerformanceSource({
            "/m/a.mp3": ENGINE_FULL,
            "/m/b.mp3": ENGINE_FULL,
        }))
        bulk(client, track_ids=[t1.id])
        assert db.query(HotCue).filter_by(track_id=t1.id).count() == 2
        assert db.query(HotCue).filter_by(track_id=t2.id).count() == 0


class TestConfirmTier:
    def _saved_track(self, db, make_track):
        t = make_track(filename="/m/a.mp3", key=3)
        add_waveform(db, t.id, cue_time=99.0)
        db.add(HotCue(track_id=t.id, slot_number=1, time_seconds=11.0, label="Mine"))
        db.add(Beatgrid(track_id=t.id, origin="edited", tempo_changes_json=json.dumps(
            [{"start_time": 0.35, "bpm": 127.0, "time_signature_num": 4,
              "time_signature_den": 4, "bar_position": 1}])))
        db.commit()
        return t

    def test_overwrites_apply_selectively(self, db, make_track, make_client):
        t = self._saved_track(db, make_track)
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))

        result = bulk(client, track_ids=[t.id], overwrites=[
            {"track_id": t.id, "field": "beatgrid"},
            {"track_id": t.id, "field": "key"},
        ])

        assert result["applied"]["beatgrid"] == 1
        assert result["applied"]["key"] == 1
        assert result["applied"]["hotcues"] == 0
        # hotcues + maincue still pending; grid + key no longer are
        assert {p["field"] for p in result["pending"]} == {"hotcues", "maincue"}
        assert db.query(Beatgrid).filter_by(track_id=t.id).one().origin == "imported"
        db.expire_all()
        assert db.query(Track).get(t.id).key == 7
        assert db.query(Waveform).filter_by(track_id=t.id).one().cue_point_time == 99.0

    def test_hotcue_overwrite_modes(self, db, make_track, make_client):
        t = self._saved_track(db, make_track)
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))

        # fill-empty merges into free slots, keeps slot 1
        bulk(client, track_ids=[t.id], overwrites=[
            {"track_id": t.id, "field": "hotcues", "mode": "fill-empty"},
        ])
        cues = {c.slot_number: c for c in db.query(HotCue).filter_by(track_id=t.id)}
        assert cues[1].label == "Mine" and cues[2].time_seconds == 60.0

        # replace-all takes Engine's set wholesale
        bulk(client, track_ids=[t.id], overwrites=[
            {"track_id": t.id, "field": "hotcues", "mode": "replace-all"},
        ])
        db.expire_all()
        cues = {c.slot_number: c for c in db.query(HotCue).filter_by(track_id=t.id)}
        assert cues[1].label == "Drop"

    def test_bulk_is_idempotent_after_full_apply(self, db, make_track, make_client):
        t = self._saved_track(db, make_track)
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": ENGINE_FULL}))
        bulk(client, track_ids=[t.id], overwrites=[
            {"track_id": t.id, "field": "hotcues", "mode": "replace-all"},
            {"track_id": t.id, "field": "beatgrid"},
            {"track_id": t.id, "field": "maincue"},
            {"track_id": t.id, "field": "key"},
        ])
        result = bulk(client, track_ids=[t.id])
        assert result["applied"] == {"hotcues": 0, "beatgrid": 0, "maincue": 0, "key": 0}
        assert result["pending"] == []

    def test_variable_grid_flagged_in_pending(self, db, make_track, make_client):
        t = self._saved_track(db, make_track)
        variable = EnginePerformanceFields(
            hotcues=None, maincue=None, key=None,
            beatgrid=grid((0.5, 128.0), (60.0, 130.0)),
        )
        client = make_client(FakeEnginePerformanceSource({"/m/a.mp3": variable}))
        result = bulk(client, track_ids=[t.id])
        [p] = [p for p in result["pending"] if p["field"] == "beatgrid"]
        assert p["variable"] is True
        assert "2 tempo changes" in p["detail"]

"""Atomic Drop-anchor stamping at the router seam."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, HotCue, MetricLadder, Waveform
from backend.routers import beatgrids


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(beatgrids.router, prefix="/api/beatgrids")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


@pytest.fixture
def make_waveform(db_session: Session):
    def _make(track_id: int, duration: float = 180.0) -> Waveform:
        waveform = Waveform(
            track_id=track_id,
            sample_rate=44100,
            duration=duration,
            samples_per_peak=512,
        )
        db_session.add(waveform)
        db_session.commit()
        return waveform

    return _make


def stamp(client: TestClient, track_id: int, drop_time: float):
    response = client.post(
        f"/api/beatgrids/{track_id}/drop-anchor",
        json={"drop_time": drop_time},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_drop_anchor_writes_grid_ladder_and_cue_ladder_atomically(
    client, db_session, make_track, make_waveform, monkeypatch
):
    track = make_track(bpm=12000)
    make_waveform(track.id)

    commits = 0
    real_commit = db_session.commit

    def counted_commit():
        nonlocal commits
        commits += 1
        real_commit()

    monkeypatch.setattr(db_session, "commit", counted_commit)
    result = stamp(client, track.id, 64.0)

    assert commits == 1
    assert result["beatgrid"]["anchor_time"] == 64.0
    assert 64.0 in result["beatgrid"]["data"]["downbeat_times"]
    assert result["metric_ladder"]["reset_marks"] == [64.0]
    assert [(cue["slot_number"], cue["time_seconds"]) for cue in result["hotcues"]] == [
        (1, 0.0),
        (2, 32.0),
        (3, 48.0),
        (4, 64.0),
    ]


def test_drop_anchor_moves_cue_4_but_preserves_soft_cues_and_existing_marks(
    client, db_session, make_track, make_waveform
):
    track = make_track(bpm=12000)
    make_waveform(track.id)
    db_session.add(MetricLadder(track_id=track.id, arities_json="[2,2,2,2]", reset_marks_json="[80.0]"))
    db_session.add_all(
        [
            HotCue(track_id=track.id, slot_number=3, time_seconds=12.0, label="keep"),
            HotCue(track_id=track.id, slot_number=4, time_seconds=20.0, color="#123456"),
        ]
    )
    db_session.commit()

    stamp(client, track.id, 64.0)

    ladder = db_session.query(MetricLadder).filter_by(track_id=track.id).one()
    assert json.loads(ladder.reset_marks_json) == [64.0, 80.0]
    cues = {
        cue.slot_number: cue
        for cue in db_session.query(HotCue).filter_by(track_id=track.id).all()
    }
    assert cues[3].time_seconds == 12.0
    assert cues[3].label == "keep"
    assert cues[4].time_seconds == 64.0
    assert cues[4].color == "#123456"
    assert cues[1].time_seconds == 0.0
    assert cues[2].time_seconds == 32.0


def test_drop_anchor_skips_soft_rungs_before_track_start(
    client, db_session, make_track, make_waveform
):
    track = make_track(bpm=12000)
    make_waveform(track.id)

    result = stamp(client, track.id, 20.0)

    assert [(cue["slot_number"], cue["time_seconds"]) for cue in result["hotcues"]] == [
        (3, 4.0),
        (4, 20.0),
    ]
    assert db_session.query(HotCue).filter_by(track_id=track.id).count() == 2


def test_drop_anchor_requires_a_waveform(client, make_track):
    track = make_track(bpm=12000)
    response = client.post(
        f"/api/beatgrids/{track.id}/drop-anchor",
        json={"drop_time": 64.0},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Waveform not found"


def test_drop_anchor_rolls_every_artifact_back_when_commit_fails(
    client, db_session, make_track, make_waveform, monkeypatch
):
    track = make_track(bpm=12000)
    make_waveform(track.id)

    def fail_commit():
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulated commit failure"):
        client.post(
            f"/api/beatgrids/{track.id}/drop-anchor",
            json={"drop_time": 64.0},
        )

    assert db_session.query(Beatgrid).filter_by(track_id=track.id).count() == 0
    assert db_session.query(MetricLadder).filter_by(track_id=track.id).count() == 0
    assert db_session.query(HotCue).filter_by(track_id=track.id).count() == 0


def test_repeating_the_same_drop_anchor_dedupes_marks_and_cues(
    client, db_session, make_track, make_waveform
):
    track = make_track(bpm=12000)
    make_waveform(track.id)

    stamp(client, track.id, 64.0)
    result = stamp(client, track.id, 64.0)

    assert result["metric_ladder"]["reset_marks"] == [64.0]
    assert db_session.query(HotCue).filter_by(track_id=track.id).count() == 4

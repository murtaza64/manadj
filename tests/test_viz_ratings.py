"""Visualizer preset ratings (#401): desktop + phone verdicts land as GA solo
events; uuid makes pushes idempotent and lets a verdict be changed."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import device_sync, visualizer_ga


@pytest.fixture
def gen(tmp_path, monkeypatch):
    monkeypatch.setattr(visualizer_ga, "GEN_DIR", tmp_path)
    monkeypatch.setattr(visualizer_ga, "MANIFEST_PATH", tmp_path / "genepool.json")
    monkeypatch.setattr(visualizer_ga, "EVENTS_PATH", tmp_path / "events.jsonl")
    (tmp_path / "g00-voyage.candidate.ts").write_text("// seed")
    return tmp_path


@pytest.fixture
def client(gen):
    app = FastAPI()
    app.include_router(visualizer_ga.router, prefix="/api/ga")
    app.include_router(device_sync.router, prefix="/api/device-sync")
    return TestClient(app)


def _events(gen):
    return [json.loads(line) for line in (gen / "events.jsonl").read_text().splitlines()]


def test_desktop_rating_is_a_solo_event_with_source_and_context(client, gen):
    r = client.post("/api/ga/ratings", json={
        "preset": "voyage", "outcome": "like", "source": "clip-editor", "uuid": "u1",
        "context": {"clip": "routine:abc", "t": 12.5}, "params": {"speed": 0.5},
    })
    assert r.status_code == 200
    assert r.json()["accepted"] == 1
    (e,) = _events(gen)
    assert e["type"] == "solo" and e["target"] == "g00-voyage" and e["outcome"] == "like"
    assert e["source"] == "clip-editor" and e["context"] == {"clip": "routine:abc", "t": 12.5}
    assert e["paramsA"] == {"speed": 0.5}
    assert r.json()["presets"]["g00-voyage"]["likes"] == 1


def test_same_uuid_replaces_and_identical_resend_is_noop(client, gen):
    body = {"preset": "g05-orbit", "outcome": "like", "source": "reviewer", "uuid": "u1"}
    client.post("/api/ga/ratings", json=body)
    assert client.post("/api/ga/ratings", json=body).json()["accepted"] == 0
    client.post("/api/ga/ratings", json={**body, "outcome": "dislike"})
    assert len(_events(gen)) == 2
    row = client.get("/api/ga/ratings").json()["presets"]["g05-orbit"]
    assert (row["likes"], row["dislikes"], row["score"]) == (0, 1, -1)
    assert row["last"]["source"] == "reviewer"


def test_legacy_solo_events_count_each(client, gen):
    (gen / "events.jsonl").write_text(
        json.dumps({"at": 1, "type": "solo", "target": "g01-a", "outcome": "like"}) + "\n"
        + json.dumps({"at": 2, "type": "solo", "target": "g01-a", "outcome": "like"}) + "\n"
        + json.dumps({"at": 3, "type": "vote", "a": "g01-a", "b": "g01-b", "outcome": "a"}) + "\n"
    )
    row = client.get("/api/ga/ratings").json()["presets"]["g01-a"]
    assert row["likes"] == 2 and row["last"]["source"] == "viz"


def test_phone_push_is_idempotent_and_keeps_receive_time(client, gen):
    batch = {"ratings": [
        {"uuid": "p1", "preset": "voyage", "outcome": "dislike", "rated_at_ms": 1_000_000},
        {"uuid": "p2", "preset": "g07-x", "outcome": "neutral", "rated_at_ms": 2_000_000, "context": {"track_id": 4}},
    ]}
    headers = {"X-Manadj-Device-Id": "pixel", "X-Manadj-Device-Name": "Pixel 9"}
    assert client.post("/api/device-sync/viz-ratings", json=batch, headers=headers).json() == {"accepted": 2, "unchanged": 0}
    assert client.post("/api/device-sync/viz-ratings", json=batch, headers=headers).json() == {"accepted": 0, "unchanged": 2}
    events = _events(gen)
    assert [e["target"] for e in events] == ["g00-voyage", "g07-x"]
    assert all(e["source"] == "phone" and e["device"] == {"id": "pixel", "name": "Pixel 9"} for e in events)
    assert events[0]["ratedAt"] == 1000 and events[0]["at"] > 1000
    tallies = client.get("/api/device-sync/viz-ratings").json()["presets"]
    assert tallies["g00-voyage"]["dislikes"] == 1 and tallies["g07-x"]["neutral"] == 1


def test_phone_push_requires_uuid_and_valid_outcome(client):
    assert client.post("/api/device-sync/viz-ratings", json={"ratings": [{"preset": "a", "outcome": "like"}]}).status_code == 422
    assert client.post("/api/device-sync/viz-ratings", json={"ratings": [{"uuid": "x", "preset": "a", "outcome": "meh"}]}).status_code == 422

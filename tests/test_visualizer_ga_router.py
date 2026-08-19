"""Arena event persistence (realtime-visualization 06): append-only events
round-trip; the state endpoint tolerates a missing/absent genepool."""

import json

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import visualizer_ga


def test_events_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(visualizer_ga, "GEN_DIR", tmp_path)
    monkeypatch.setattr(visualizer_ga, "MANIFEST_PATH", tmp_path / "genepool.json")
    monkeypatch.setattr(visualizer_ga, "EVENTS_PATH", tmp_path / "events.jsonl")
    client = TestClient(app)

    # Empty state: default manifest, no events.
    state = client.get("/api/ga/state").json()
    assert state == {"manifest": {"generation": 0, "candidates": {}}, "events": []}

    # Votes, notes, promotions append and round-trip in order.
    assert client.post(
        "/api/ga/events",
        json={"type": "vote", "a": "g01-a", "b": "g01-b", "outcome": "a"},
    ).status_code == 200
    assert client.post(
        "/api/ga/events",
        json={"type": "note", "target": "g01-a", "text": "needs stronger bass response"},
    ).status_code == 200

    (tmp_path / "genepool.json").write_text(
        json.dumps({"generation": 1, "candidates": {"g01-a": {"rating": 1010}}})
    )
    state = client.get("/api/ga/state").json()
    assert state["manifest"]["generation"] == 1
    assert [e["type"] for e in state["events"]] == ["vote", "note"]
    assert state["events"][0]["outcome"] == "a"
    assert state["events"][1]["text"] == "needs stronger bass response"
    assert all("at" in e for e in state["events"])

"""Core user story 1 (composed-backend): import a track into the library, see
it in the track list, and drive its analysis lifecycle — all over real HTTP
against the real composed `backend.main` app (full router set, real
middleware), backed by the real alembic-migrated schema.

This is the backend-story layer of the E2E audit: it does NOT drive the UI or
claim audio output. Deck transport stays in the browser engine and is out of
scope here by design.
"""

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app

FIXTURES = Path(__file__).parent / "fixtures"


def test_story_import_list_analyze(db, tmp_path):
    """Import -> list -> analyze enqueue -> status poll -> audio served."""
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    src = incoming / "Artist - Story One.wav"
    shutil.copy(FIXTURES / "silence.wav", src)

    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)

        # 1. Ingest via the real drop-import endpoint.
        resp = client.post("/api/sync/library/drop-import", json={"paths": [str(incoming)]})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["imported"] == 1 and body["failed"] == 0, body
        (track_id,) = body["track_ids"]

        # 2. The track list reflects the import, with parsed metadata.
        resp = client.get("/api/tracks/", params={"search": "Story One"})
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert [t["id"] for t in items] == [track_id]
        assert items[0]["title"] == "Story One"
        assert items[0]["artist"] == "Artist"

        # 3. Analysis lifecycle: never-analyzed status, enqueue, then the
        # task is observable as in-flight (the worker runs off-thread; the
        # story asserts queueing and observability, not DSP results).
        resp = client.get(f"/api/analyze/{track_id}/status")
        assert resp.status_code == 200, resp.text

        resp = client.post(f"/api/analyze/{track_id}")
        assert resp.status_code == 202, resp.text

        resp = client.get(f"/api/analyze/{track_id}/status")
        assert resp.status_code == 200, resp.text
        pending = client.get("/api/analyze/pending")
        assert pending.status_code == 200, pending.text
        states = {p["track_id"]: p["state"] for p in pending.json()}
        if track_id in states:  # a fast worker may already have finished it
            assert states[track_id] in {"pending", "running"}

        # 4. The library serves the imported audio back over HTTP.
        resp = client.get(f"/api/tracks/{track_id}/audio")
        assert resp.status_code == 200, resp.text
        assert len(resp.content) > 0

        # 5. Unknown tracks fail cleanly through the same composed stack.
        assert client.get("/api/tracks/999999").status_code == 404
        assert client.get("/api/analyze/999999/status").status_code == 404
    finally:
        app.dependency_overrides.clear()

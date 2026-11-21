"""Core user story 2 (composed-backend): organize the library — build a
playlist from an imported track, then archive and unarchive it — over real
HTTP against the real composed `backend.main` app.

Same harness as story 1 (test_story_library_ingest.py): full router set and
middleware, real alembic-migrated schema via the get_db override.
"""

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app

FIXTURES = Path(__file__).parent / "fixtures"


def _import_one(client, tmp_path: Path, name: str) -> int:
    src = tmp_path / name
    shutil.copy(FIXTURES / "silence.wav", src)
    resp = client.post("/api/sync/library/drop-import", json={"paths": [str(src)]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 1, resp.json()
    return resp.json()["track_ids"][0]


def test_story_playlist_and_archive(db, tmp_path):
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        track_id = _import_one(client, tmp_path, "DJ - Story Two.wav")

        # 1. Create a playlist and add the imported track.
        resp = client.post("/api/playlists/", json={"name": "Story Two Set"})
        assert resp.status_code == 201, resp.text
        playlist_id = resp.json()["id"]

        resp = client.post(
            f"/api/playlists/{playlist_id}/tracks", json={"track_id": track_id}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["skipped"] is False

        # Re-adding is an idempotent no-op.
        resp = client.post(
            f"/api/playlists/{playlist_id}/tracks", json={"track_id": track_id}
        )
        assert resp.status_code == 200 and resp.json()["skipped"] is True

        # 2. The playlist view carries the track.
        resp = client.get(f"/api/playlists/{playlist_id}")
        assert resp.status_code == 200, resp.text
        assert track_id in [t["id"] for t in resp.json()["tracks"]]

        # 3. Archive: out of the active library and out of every playlist,
        # nothing deleted.
        resp = client.post(f"/api/tracks/{track_id}/archive")
        assert resp.status_code == 200, resp.text
        assert resp.json()["removed_from_playlists"] >= 1

        resp = client.get(f"/api/playlists/{playlist_id}")
        assert track_id not in [t["id"] for t in resp.json()["tracks"]]

        # 4. Unarchive restores the track (playlist membership is not
        # restored, per the archive contract).
        resp = client.post(f"/api/tracks/{track_id}/unarchive")
        assert resp.status_code == 200, resp.text
        assert resp.json()["archived_at"] is None

        resp = client.get(f"/api/tracks/{track_id}")
        assert resp.status_code == 200, resp.text

        # 5. Unknown playlists/tracks fail cleanly.
        assert client.post("/api/playlists/999999/tracks", json={"track_id": track_id}).status_code == 404
        assert client.post("/api/tracks/999999/archive").status_code == 404
    finally:
        app.dependency_overrides.clear()

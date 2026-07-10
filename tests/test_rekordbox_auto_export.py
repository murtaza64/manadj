"""Auto tier: new-only export → Rekordbox (rekordbox-perf-export/05).

Issue 08 semantics: additive flows run unconfirmed (hot cues add-only,
key only where RB has none); anything touching an existing RB value
stays behind the per-field confirm verbs. Router seam faked (ADR
0002/0004).
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import HotCue, Track
from rekordbox.perf_export import TrackNotInRekordboxError


class FakeExporter:
    def __init__(self, unmatched: set[str] = frozenset(), keyless: set[str] = frozenset()):
        self.unmatched = unmatched
        self.keyless_in_rb = keyless
        self.hotcue_calls = []
        self.key_calls = []

    def export_hotcues(self, filename, cues, mode):
        if filename in self.unmatched:
            raise TrackNotInRekordboxError(filename)
        self.hotcue_calls.append((filename, cues, mode))
        return {"added": len(cues), "moved": 0, "deleted": 0, "refreshed": 0,
                "skipped_slots": []}

    def export_key(self, filename, engine_key_id, only_if_absent=False):
        if filename in self.unmatched:
            raise TrackNotInRekordboxError(filename)
        assert only_if_absent, "auto tier must never overwrite RB keys"
        self.key_calls.append((filename, engine_key_id))
        return "Am" if filename in self.keyless_in_rb else None


@pytest.fixture
def make_client(db: Session):
    from backend.routers import sync_export

    def _make(exporter: FakeExporter) -> TestClient:
        app = FastAPI()
        app.include_router(sync_export.router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[sync_export.get_rekordbox_perf_exporter] = (
            lambda: exporter
        )
        return TestClient(app)

    return _make


def seed(db, filename, *, key=None, cues=0):
    t = Track(filename=filename, title=filename, key=key)
    db.add(t)
    db.commit()
    for i in range(cues):
        db.add(HotCue(track_id=t.id, slot_number=i + 1, time_seconds=10.0 * (i + 1)))
    db.commit()
    db.refresh(t)
    return t


def test_auto_exports_cues_add_only_and_absent_keys(make_client, db):
    seed(db, "/m/a.flac", key=7, cues=2)
    seed(db, "/m/b.flac", key=3)          # key only; RB already has one
    seed(db, "/m/c.flac")                  # nothing exportable: not scanned
    exporter = FakeExporter(keyless={"/m/a.flac"})
    res = make_client(exporter).post(
        "/api/sync/export/rekordbox/auto", json={"track_ids": None}
    )
    assert res.status_code == 200
    body = res.json()
    assert body == {"scanned": 2, "matched": 2, "cues_added": 2, "keys_set": 1,
                    "unmatched": 0}
    (fn, cues, mode), = exporter.hotcue_calls
    assert (fn, mode) == ("/m/a.flac", "add-only")
    assert {c[0] for c in cues} == {1, 2}
    assert {c[0] for c in exporter.key_calls} == {"/m/a.flac", "/m/b.flac"}


def test_unmatched_tracks_counted_not_fatal(make_client, db):
    seed(db, "/m/gone.flac", cues=1)
    seed(db, "/m/here.flac", cues=1)
    exporter = FakeExporter(unmatched={"/m/gone.flac"})
    body = make_client(exporter).post(
        "/api/sync/export/rekordbox/auto", json={"track_ids": None}
    ).json()
    assert body["unmatched"] == 1 and body["matched"] == 1


def test_track_ids_filter(make_client, db):
    a = seed(db, "/m/a.flac", cues=1)
    seed(db, "/m/b.flac", cues=1)
    exporter = FakeExporter()
    body = make_client(exporter).post(
        "/api/sync/export/rekordbox/auto", json={"track_ids": [a.id]}
    ).json()
    assert body["scanned"] == 1
    assert [c[0] for c in exporter.hotcue_calls] == ["/m/a.flac"]

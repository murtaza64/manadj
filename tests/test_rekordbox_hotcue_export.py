"""Hotcue export → Rekordbox (rekordbox-perf-export/03).

Planner is pure (all mirror semantics live there); router faked at the
exporter seam (ADR 0002/0004).
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import HotCue, Track
from rekordbox.perf_export import plan_hotcue_export


def hot(row_id: str, slot: int, ms: int):
    return SimpleNamespace(ID=row_id, Kind=slot, InMsec=ms)


def mem(row_id: str, ms: int):
    return SimpleNamespace(ID=row_id, Kind=0, InMsec=ms)


# -- planner: add-only tier ----------------------------------------------------


def test_add_only_creates_pairs_for_new_slots():
    plan = plan_hotcue_export({1: 30000, 3: 60000}, [], [], "add-only")
    assert [(a.slot, a.rb_ms, a.memory_twin) for a in plan.adds] == [
        (1, 30000, True),
        (3, 60000, True),
    ]
    assert not plan.moves and not plan.soft_deletes


def test_add_only_never_touches_existing_rows():
    plan = plan_hotcue_export(
        {1: 99999, 2: 50000},  # slot 1 differs from RB's position
        [hot("h1", 1, 30000)],
        [mem("m1", 30000)],
        "add-only",
    )
    assert plan.skipped_slots == [1]
    assert [(a.slot, a.rb_ms) for a in plan.adds] == [(2, 50000)]
    assert not plan.moves and not plan.soft_deletes


def test_add_only_reuses_existing_memory_cue_at_position():
    plan = plan_hotcue_export({1: 30000}, [], [mem("m1", 30000)], "add-only")
    assert [(a.slot, a.memory_twin) for a in plan.adds] == [(1, False)]


# -- planner: replace-all reconcile ---------------------------------------------


def test_replace_moves_both_mirror_rows():
    plan = plan_hotcue_export(
        {1: 40000},
        [hot("h1", 1, 30000)],
        [mem("m1", 30000)],
        "replace-all",
    )
    assert {(m.row_id, m.rb_ms) for m in plan.moves} == {("h1", 40000), ("m1", 40000)}
    assert not plan.adds and not plan.soft_deletes


def test_replace_creates_twin_when_moved_cue_had_none():
    plan = plan_hotcue_export({1: 40000}, [hot("h1", 1, 30000)], [], "replace-all")
    assert [(m.row_id, m.rb_ms) for m in plan.moves] == [("h1", 40000)]
    assert [(a.slot, a.rb_ms) for a in plan.adds] == [(0, 40000)]  # bare twin


def test_replace_deletes_rb_only_cues_and_strays():
    plan = plan_hotcue_export(
        {1: 30000},
        [hot("h1", 1, 30000), hot("h2", 5, 70000)],  # slot 5 not in Library
        [mem("m1", 30000), mem("m2", 70000), mem("m3", 90000)],  # m3 = stray
        "replace-all",
    )
    assert set(plan.soft_deletes) == {"h2", "m2", "m3"}
    assert not plan.moves and not plan.adds


def test_replace_identical_mirror_is_empty_plan():
    plan = plan_hotcue_export(
        {1: 30000, 2: 50000},
        [hot("h1", 1, 30000), hot("h2", 2, 50000)],
        [mem("m1", 30000), mem("m2", 50000)],
        "replace-all",
    )
    assert plan.empty
    assert not plan.skipped_slots


# -- router seam ----------------------------------------------------------------


class FakeExporter:
    def __init__(self):
        self.calls = []

    def export_hotcues(self, filename, cues, mode):
        self.calls.append((filename, cues, mode))
        return {"added": len(cues), "moved": 0, "deleted": 0, "skipped_slots": []}


@pytest.fixture
def client_and_track(db: Session):
    from backend.routers import sync_export

    track = Track(filename="/music/t.flac", title="T")
    db.add(track)
    db.commit()
    db.add(HotCue(track_id=track.id, slot_number=3, time_seconds=30.0, label="Drop"))
    db.commit()
    db.refresh(track)

    exporter = FakeExporter()
    app = FastAPI()
    app.include_router(sync_export.router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[sync_export.get_rekordbox_perf_exporter] = lambda: exporter
    return TestClient(app), track, exporter


def test_exports_library_cues(client_and_track):
    client, track, exporter = client_and_track
    res = client.post(
        "/api/sync/export/hotcues/rekordbox",
        json={"track_id": track.id, "mode": "add-only"},
    )
    assert res.status_code == 200
    assert res.json()["added"] == 1
    assert exporter.calls == [("/music/t.flac", [(3, 30.0)], "add-only")]


def test_cueless_track_409(client_and_track, db):
    client, _, exporter = client_and_track
    bare = Track(filename="/music/bare.flac", title="Bare")
    db.add(bare)
    db.commit()
    db.refresh(bare)
    res = client.post(
        "/api/sync/export/hotcues/rekordbox",
        json={"track_id": bare.id, "mode": "replace-all"},
    )
    assert res.status_code == 409
    assert exporter.calls == []


def test_replace_heals_missing_memory_twin():
    """In-place identical cue with no memory twin: replace-all restores
    the mirror invariant; add-only leaves it alone."""
    plan = plan_hotcue_export({1: 30000}, [hot("h1", 1, 30000)], [], "replace-all")
    assert [(a.slot, a.rb_ms) for a in plan.adds] == [(0, 30000)]
    assert plan_hotcue_export({1: 30000}, [hot("h1", 1, 30000)], [], "add-only").empty

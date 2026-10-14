"""Two-way Device sync (ADR 0045, #375): phone edits, newest wins, change log, revert."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.device_edits import PushedEdit, apply_edits, list_changes, read_field, revert, revert_batch
from backend.models import DeviceSyncChange, HotCue, Tag, TagCategory, TrackTag
from backend.routers import device_listener as control
from backend.routers.device_sync import router as sync_router


def ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


NOW = datetime.now(timezone.utc).replace(tzinfo=None)


def edit(track, field, old, new, at=NOW, uid=None):
    return PushedEdit(uid or f"{track.id}-{field}-{new}", track.id, field, old, new, ms(at))


@pytest.fixture
def tag(db):
    cat = TagCategory(name="Vibe")
    db.add(cat)
    db.flush()
    t = Tag(name="Dark", category_id=cat.id)
    db.add(t)
    db.commit()
    return t


def test_phone_edits_apply_and_are_logged(db, make_track, tag):
    track = make_track(title="Old", energy=2)
    cue = {"time": 12.5, "label": "drop", "color": "#ff0000"}
    batch, outcomes = apply_edits(db, "phone-1", "Pixel", [
        edit(track, "hot_cue:3", None, cue),
        edit(track, "main_cue", None, 1.25),
        edit(track, f"tag:{tag.id}", False, True),
        edit(track, "title", "Old", "New"),
        edit(track, "energy", 2, 4),
    ])
    assert set(outcomes.values()) == {"applied"}
    db.refresh(track)
    assert (track.title, track.energy, track.cue_point_time) == ("New", 4, 1.25)
    assert read_field(db, track, "hot_cue:3")[0] == cue
    assert db.query(TrackTag).filter_by(track_id=track.id, tag_id=tag.id).count() == 1
    rows = db.query(DeviceSyncChange).filter_by(batch_id=batch).all()
    assert len(rows) == 5 and {r.direction for r in rows} == {"to_desktop"} and {r.device_name for r in rows} == {"Pixel"}


def test_newest_wins_desktop_later_change_supersedes(db, make_track):
    track = make_track()
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=30.0))
    db.commit()  # desktop set slot 1 "now"
    earlier = NOW - timedelta(hours=1)
    _, outcomes = apply_edits(db, "phone-1", None, [edit(track, "hot_cue:1", None, {"time": 5.0}, at=earlier)])
    assert list(outcomes.values()) == ["superseded"]
    assert read_field(db, track, "hot_cue:1")[0]["time"] == 30.0


def test_newest_wins_phone_later_edit_overrides(db, make_track):
    track = make_track()
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=30.0, updated_at=NOW - timedelta(hours=2)))
    db.commit()
    _, outcomes = apply_edits(db, "phone-1", None, [edit(track, "hot_cue:1", None, {"time": 5.0}, at=NOW - timedelta(minutes=1))])
    assert list(outcomes.values()) == ["applied"]
    assert read_field(db, track, "hot_cue:1")[0]["time"] == 5.0


def test_future_edit_times_are_clamped(db, make_track):
    track = make_track(title="A")
    _, out = apply_edits(db, "p", None, [edit(track, "title", "A", "B", at=NOW + timedelta(days=365))])
    [row] = db.query(DeviceSyncChange).all()
    assert out[row.edit_uuid] == "applied" and row.edited_at <= datetime.now(timezone.utc).replace(tzinfo=None)


def test_rejects_bad_fields_and_archived_tracks(db, make_track):
    live, gone = make_track(), make_track(archived_at=NOW)
    _, out = apply_edits(db, "p", None, [
        edit(live, "bpm", 170, 174, uid="a"),
        edit(live, "hot_cue:9", None, {"time": 1}, uid="b"),
        edit(live, "energy", None, 9, uid="c"),
        edit(gone, "title", None, "x", uid="d"),
    ])
    assert out == {"a": "rejected", "b": "rejected", "c": "rejected", "d": "rejected"}


def test_repush_is_idempotent(db, make_track):
    track = make_track(title="A")
    e = edit(track, "title", "A", "B", uid="same")
    apply_edits(db, "p", None, [e])
    _, out = apply_edits(db, "p", None, [e])
    assert out == {"same": "applied"}
    assert db.query(DeviceSyncChange).count() == 1


def test_revert_entry_and_batch(db, make_track):
    track = make_track(title="A", energy=1)
    batch, _ = apply_edits(db, "p", None, [edit(track, "title", "A", "B"), edit(track, "energy", 1, 3)])
    title_row = db.query(DeviceSyncChange).filter_by(field="title").one()
    [r] = revert(db, [title_row.id])
    db.refresh(track)
    assert track.title == "A" and r.reverts_id == title_row.id
    assert revert(db, [title_row.id]) == []  # once only
    revert_batch(db, batch)  # remaining entry (energy)
    db.refresh(track)
    assert track.energy == 1
    rows = list_changes(db)
    assert sum(1 for c in rows if c["reverts_id"]) == 2
    assert not any(c["revertable"] for c in rows if c["field"] == "title" and not c["reverts_id"])


def test_revert_hot_cue_restores_absence(db, make_track):
    track = make_track()
    apply_edits(db, "p", None, [edit(track, "hot_cue:2", None, {"time": 3.0})])
    revert(db, [db.query(DeviceSyncChange).one().id])
    assert read_field(db, track, "hot_cue:2")[0] is None


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(sync_router, prefix="/api/device-sync")
    app.include_router(control.router, prefix="/api/device-listener")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_endpoints_push_received_list_revert(client, make_track):
    track = make_track(title="A")
    headers = {"X-Manadj-Device-Id": "phone-9", "X-Manadj-Device-Name": "Pixel"}
    body = {"edits": [{"uuid": "u1", "track_id": track.id, "field": "title", "old": "A", "new": "B", "edited_at_ms": ms(NOW)}]}
    pushed = client.post("/api/device-sync/edits", json=body, headers=headers).json()
    assert pushed["outcomes"] == {"u1": "applied"}
    got = client.post("/api/device-sync/received", headers=headers,
                      json={"changes": [{"track_id": track.id, "field": "energy", "old": None, "new": 3}]}).json()
    assert got["batch_id"]
    changes = client.get("/api/device-listener/changes").json()
    assert [c["direction"] for c in changes] == ["to_phone", "to_desktop"]
    assert changes[1]["device_name"] == "Pixel" and changes[1]["track_title"] == "B"
    reverted = client.post(f"/api/device-listener/batches/{pushed['batch_id']}/revert").json()
    assert reverted[0]["new"] == "A"
    assert client.post(f"/api/device-listener/changes/{changes[1]['id']}/revert").status_code == 409


def test_synced_setting_edits_newest_wins_logged_and_revertable(db):
    from backend.device_edits import read_setting
    from backend.models import AppSetting

    key = "manadj-filter-settings"
    default, _ = read_setting(db, key)
    mine = {**default, "resonance": 12.0}
    batch, outcomes = apply_edits(db, "phone-1", "Pixel", [
        PushedEdit("s1", None, f"setting:{key}", default, mine, ms(NOW - timedelta(seconds=5))),
        PushedEdit("s2", None, "setting:manadj-quantize", None, {"x": 1}, ms(NOW)),  # not synced
    ])
    assert outcomes == {"s1": "applied", "s2": "rejected"}
    assert read_setting(db, key)[0] == mine
    row = db.query(DeviceSyncChange).filter_by(edit_uuid="s1").one()
    assert row.track_id is None and row.field == f"setting:{key}"

    # The desktop changes it after an older phone edit: newest wins.
    later = {**default, "resonance": 20.0}
    db.get(AppSetting, key).value = '{"model":"res24","resonance":20.0}'
    db.commit()
    _, outcomes = apply_edits(db, "phone-1", "Pixel", [
        PushedEdit("s3", None, f"setting:{key}", default, later, ms(NOW - timedelta(hours=1))),
    ])
    assert outcomes == {"s3": "superseded"}

    revert(db, [row.id])
    assert read_setting(db, key)[0] == default
    changes = list_changes(db)
    assert changes[0]["field"] == f"setting:{key}" and changes[0]["track_title"] is None

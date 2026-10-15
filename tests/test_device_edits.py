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


def test_grid_and_reset_marks_edits(db, make_track):
    from backend.models import Beatgrid, MetricLadder

    track = make_track()
    grid = {"anchor_time": 0.5, "tempo_changes": [
        {"start_time": 0.5, "bpm": 174, "time_signature_num": 4, "time_signature_den": 4, "bar_position": 1}]}
    _, outcomes = apply_edits(db, "phone-1", "Pixel", [
        edit(track, "grid", None, grid, uid="g1"),
        edit(track, "reset_marks", [], [64.2, 32.1], uid="r1"),
    ])
    assert outcomes == {"g1": "applied", "r1": "applied"}
    bg = db.query(Beatgrid).filter_by(track_id=track.id).one()
    assert bg.origin == "edited" and bg.anchor_time == 0.5
    assert read_field(db, track, "grid")[0]["tempo_changes"][0]["bpm"] == 174.0
    db.refresh(track)
    assert track.bpm_projected == 174.0
    assert read_field(db, track, "reset_marks")[0] == [32.1, 64.2]

    # Re-push of the same values is a no-op "applied"; bad grids are rejected.
    _, outcomes = apply_edits(db, "phone-1", "Pixel", [
        edit(track, "grid", grid, {"anchor_time": None, "tempo_changes": []}, uid="g2"),
        edit(track, "reset_marks", [32.1, 64.2], [-1], uid="r2"),
    ])
    assert outcomes == {"g2": "rejected", "r2": "rejected"}

    # Clearing: grid null deletes the saved grid; [] marks drop the ladder row.
    rows = {r.edit_uuid: r for r in db.query(DeviceSyncChange)}
    _, outcomes = apply_edits(db, "phone-1", "Pixel", [
        edit(track, "grid", grid, None, uid="g3"),
        edit(track, "reset_marks", [32.1, 64.2], [], uid="r3"),
    ])
    assert outcomes == {"g3": "applied", "r3": "applied"}
    assert db.query(Beatgrid).filter_by(track_id=track.id).count() == 0
    assert db.query(MetricLadder).filter_by(track_id=track.id).count() == 0
    revert(db, [rows["g1"].id])
    assert db.query(Beatgrid).filter_by(track_id=track.id).count() == 0  # g1 old was null


def test_snapshot_carries_metric_ladder(db, make_track):
    from backend.crud import upsert_metric_ladder
    from backend.routers.device_sync import build_snapshot

    a = make_track()
    b = make_track()
    upsert_metric_ladder(db, a.id, [16.0])
    tracks = {t["id"]: t for t in build_snapshot(db)["tracks"]}
    assert tracks[a.id]["metric_ladder"] == {"arities": [2, 2, 2, 2], "reset_marks": [16.0]}
    assert tracks[b.id]["metric_ladder"] is None


def test_link_edits_pair_level_newest_wins_logged_and_revertable(db, make_track):
    """#398: phone Link toggle — one fact per unordered pair, either Track may carry it."""
    from backend.models import TrackLink

    a, b, c, gone = make_track(title="A"), make_track(title="B"), make_track(), make_track(archived_at=NOW)
    _, out = apply_edits(db, "p", None, [
        edit(b, f"link:{a.id}", False, True, uid="ab"),  # high→low order still addresses {a, b}
        edit(a, f"link:{a.id}", False, True, uid="self"),
        edit(a, f"link:{gone.id}", False, True, uid="gone"),
        edit(a, f"link:{c.id}", False, "yes", uid="bad"),
    ])
    assert out == {"ab": "applied", "self": "rejected", "gone": "rejected", "bad": "rejected"}
    [row] = db.query(TrackLink).all()
    assert (row.low_track_id, row.high_track_id) == tuple(sorted((a.id, b.id)))
    assert read_field(db, a, f"link:{b.id}")[0] is True

    # Desktop linked a/c after an older phone unlink of the same pair: newest wins.
    db.add(TrackLink(low_track_id=min(a.id, c.id), high_track_id=max(a.id, c.id)))
    db.commit()
    _, out = apply_edits(db, "p", None, [edit(a, f"link:{c.id}", False, False, at=NOW - timedelta(hours=1), uid="old")])
    assert out == {"old": "superseded"} and read_field(db, a, f"link:{c.id}")[0] is True

    ab = db.query(DeviceSyncChange).filter_by(edit_uuid="ab").one()
    logged = next(r for r in list_changes(db) if r["id"] == ab.id)
    assert logged["link_title"] == "A" and logged["track_title"] == "B" and logged["revertable"]
    revert(db, [ab.id])
    assert read_field(db, a, f"link:{b.id}")[0] is False


def test_snapshot_links_reach_phone_after_link_push(client, make_track):
    a, b = make_track(), make_track()
    body = {"edits": [{"uuid": "l1", "track_id": a.id, "field": f"link:{b.id}", "old": False, "new": True, "edited_at_ms": ms(NOW)}]}
    assert client.post("/api/device-sync/edits", json=body).json()["outcomes"] == {"l1": "applied"}
    assert sorted((a.id, b.id)) in client.get("/api/device-sync/snapshot").json()["links"]
    got = client.post("/api/device-sync/received", json={"changes": [{"track_id": a.id, "field": f"link:{b.id}", "old": True, "new": False}]})
    assert got.status_code == 200

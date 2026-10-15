"""Device sync (#372): the read-only snapshot a phone pulls."""

import json
import struct
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.models import (
    Beatgrid,
    Cameo,
    HotCue,
    Playlist,
    PlaylistTrack,
    Tag,
    TagCategory,
    Take,
    TrackLink,
    TrackTag,
    Transition,
    Waveform,
)
from backend.routers.device_sync import router


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/device-sync")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _take(db, a, b, kind="handover", at=datetime(2026, 1, 1)):
    db.add(Take(uuid=f"take-{a}-{b}-{kind}-{at.isoformat()}", a_track_id=a, b_track_id=b, detected_at=at, window_start_s=0,
                window_end_s=1, confidence=1, detector_version=1, params_json="{}",
                events_json="[]", kind=kind))


def _pair(db, model, a, b, favorite, n):
    if model is Transition:
        db.add(Transition(a_track_id=a, b_track_id=b, uuid=f"t-{a}-{b}-{n}", position=n, name="x",
                          favorite=favorite, data_json="{}"))
    else:
        db.add(Cameo(host_track_id=a, guest_track_id=b, uuid=f"c-{a}-{b}-{n}", position=n, name="x",
                     favorite=favorite, data_json="{}"))


def test_snapshot_carries_track_list_fields(client, db, make_track, tmp_path):
    audio = tmp_path / "one.mp3"
    audio.write_bytes(b"abc")
    cat = TagCategory(name="Genre", color="#ff0000", display_order=1)
    db.add(cat)
    db.flush()
    tag = Tag(name="Neuro", category_id=cat.id, color=None, display_order=0)
    db.add(tag)
    track = make_track(filename=str(audio), bpm=17400, key=15, energy=4, duration_secs=300.0,
                       cue_point_time=1.5, title="One", artist="A")
    db.add(TrackTag(track_id=track.id, tag_id=tag.id))
    db.add(HotCue(track_id=track.id, slot_number=2, time_seconds=12.0, label="drop", color="#00ff00"))
    db.add(Waveform(track_id=track.id, sample_rate=44100, duration=300.0, samples_per_peak=128,
                    preview_blob=b"MWF1preview"))
    db.commit()

    body = client.get("/api/device-sync/snapshot").json()

    assert body["version"] == 1
    assert body["tag_categories"] == [{"id": cat.id, "name": "Genre", "display_order": 1, "color": "#ff0000"}]
    assert body["tags"][0]["name"] == "Neuro"
    [row] = body["tracks"]
    assert row["title"] == "One" and row["artist"] == "A"
    assert row["file_name"] == "one.mp3"
    assert row["bpm"] == 174.0
    assert (row["key"], row["key_openkey"], row["key_camelot"]) == (15, "8m", "3A")
    assert row["energy"] == 4 and row["main_cue"] == 1.5
    assert row["date_added"]
    assert row["tag_ids"] == [tag.id]
    assert row["hot_cues"] == [{"slot": 2, "time": 12.0, "label": "drop", "color": "#00ff00"}]
    assert row["audio_rev"] and row["preview_rev"]
    assert row["grid"] is None


def test_snapshot_bpm_is_grid_first_and_ships_saved_grid(client, db, make_track):
    track = make_track(bpm=8700)
    changes = [{"start_time": 0.1, "bpm": 174.0, "time_signature_num": 4, "bar_position": 1}]
    db.add(Beatgrid(track_id=track.id, tempo_changes_json=json.dumps(changes), origin="edited", anchor_time=0.1))
    db.commit()

    [row] = client.get("/api/device-sync/snapshot").json()["tracks"]

    assert row["bpm"] == 174.0
    assert row["grid"] == {"origin": "edited", "anchor_time": 0.1, "tempo_changes": changes}
    assert row["audio_rev"] is None  # file missing


def test_snapshot_excludes_archived_tracks_and_their_edges(client, db, make_track):
    live = make_track()
    gone = make_track(archived_at=datetime(2026, 1, 1))
    db.add(TrackLink(low_track_id=min(live.id, gone.id), high_track_id=max(live.id, gone.id)))
    db.commit()

    body = client.get("/api/device-sync/snapshot").json()

    assert [t["id"] for t in body["tracks"]] == [live.id]
    assert body["links"] == []


def test_snapshot_follow_edges(client, db, make_track):
    a, b, c = make_track(), make_track(), make_track()
    db.add(TrackLink(low_track_id=a.id, high_track_id=c.id))
    _pair(db, Transition, a.id, b.id, False, 0)
    _pair(db, Transition, a.id, b.id, True, 1)
    _pair(db, Cameo, b.id, c.id, False, 0)
    _take(db, b.id, a.id, at=datetime(2026, 1, 1))
    _take(db, b.id, a.id, at=datetime(2026, 2, 1))
    _take(db, c.id, a.id, kind="guest")
    db.commit()

    body = client.get("/api/device-sync/snapshot").json()

    assert body["links"] == [[a.id, c.id]]
    assert body["transitions"] == [{"a": a.id, "b": b.id, "count": 2, "favorite": True}]
    assert body["cameos"] == [{"host": b.id, "guest": c.id, "count": 1, "favorite": False}]
    [take] = body["takes"]
    assert (take["a"], take["b"], take["count"]) == (b.id, a.id, 2)
    assert take["last_at"].startswith("2026-02-01")


def test_previews_pack(client, db, make_track):
    a, b, c = make_track(), make_track(), make_track()
    db.add(Waveform(track_id=a.id, sample_rate=1, duration=1, samples_per_peak=1, preview_blob=b"AAAA"))
    db.add(Waveform(track_id=b.id, sample_rate=1, duration=1, samples_per_peak=1, preview_blob=None))
    db.commit()

    raw = client.post("/api/device-sync/previews", json={"track_ids": [a.id, b.id, c.id]}).content

    assert raw[:4] == b"MPK1"
    (count,) = struct.unpack_from("<I", raw, 4)
    assert count == 1
    track_id, length = struct.unpack_from("<II", raw, 8)
    assert (track_id, length) == (a.id, 4)
    assert raw[16:20] == b"AAAA"


def test_audio_served_with_rev(client, make_track, tmp_path):
    audio = tmp_path / "decoy.mp3"
    audio.write_bytes(b"0123456789")
    track = make_track(filename=str(audio))

    response = client.get(f"/api/device-sync/tracks/{track.id}/audio", headers={"Range": "bytes=2-4"})

    assert response.status_code == 206
    assert response.content == b"234"
    assert response.headers["X-Audio-Rev"]
    assert client.get("/api/device-sync/tracks/999/audio").status_code == 404


def test_snapshot_playlists_in_play_order(client, db, make_track):
    a, b, c = make_track(), make_track(), make_track(archived_at=datetime(2026, 1, 1))
    second = Playlist(name="Warmup", color="#00ff00", display_order=1)
    first = Playlist(name="Peak", display_order=0)
    db.add_all([second, first])
    db.flush()
    db.add_all([
        PlaylistTrack(playlist_id=second.id, track_id=b.id, position=0),
        PlaylistTrack(playlist_id=second.id, track_id=c.id, position=1),
        PlaylistTrack(playlist_id=second.id, track_id=a.id, position=2),
    ])
    db.commit()

    body = client.get("/api/device-sync/snapshot").json()

    assert [p["name"] for p in body["playlists"]] == ["Peak", "Warmup"]
    assert body["playlists"][1] == {
        "id": second.id, "name": "Warmup", "color": "#00ff00", "display_order": 1,
        "track_ids": [b.id, a.id],  # Play order; archived member dropped
    }


def test_detail_waveform_served_with_rev(client, db, make_track):
    track, bare = make_track(), make_track()
    db.add(Waveform(track_id=track.id, sample_rate=44100, duration=1.0, samples_per_peak=128,
                    data_blob=b"MWF1full", preview_blob=b"MWF1prev"))
    db.commit()

    rows = {t["id"]: t for t in client.get("/api/device-sync/snapshot").json()["tracks"]}
    assert rows[track.id]["waveform_rev"] and rows[bare.id]["waveform_rev"] is None

    r = client.get(f"/api/device-sync/tracks/{track.id}/waveform")
    assert r.status_code == 200 and r.content == b"MWF1full"
    assert r.headers["X-Waveform-Rev"] == rows[track.id]["waveform_rev"]
    assert client.get(f"/api/device-sync/tracks/{bare.id}/waveform").status_code == 404


def test_snapshot_synced_settings_user_value_else_shipped_default(client, db):
    from backend.models import AppSetting
    from backend.shipped_defaults import shipped_settings

    def settings():
        return client.get("/api/device-sync/snapshot").json()["settings"]

    shipped = {k: json.loads(shipped_settings()[k]) for k in ("manadj.waveformStyles", "manadj-filter-settings", "manadj-follow-params")}
    assert settings() == {k: {"value": v, "updated_at": None} for k, v in shipped.items()}

    mine = {"version": 1, "full": {"styleId": "additive-rgb", "params": {"master": 0.5}}, "minimap": {"styleId": "additive-rgb", "params": {}}}
    db.add(AppSetting(key="manadj.waveformStyles", value=json.dumps(mine)))
    db.add(AppSetting(key="manadj-filter-settings", value="not json"))
    db.add(AppSetting(key="manadj-quantize", value="true"))  # not synced
    db.commit()
    got = settings()
    assert set(got) == {"manadj.waveformStyles", "manadj-filter-settings", "manadj-follow-params"}
    assert got["manadj.waveformStyles"]["value"] == mine
    assert got["manadj.waveformStyles"]["updated_at"] is not None
    assert got["manadj-filter-settings"] == {"value": shipped["manadj-filter-settings"], "updated_at": None}


def test_sessions_list_and_detail_for_phone_replay(client, db):
    """#378: the phone lists Sessions and pulls one event log on demand."""
    from backend.models import Session as SessionRow, SessionChunk

    s = SessionRow(uuid="s-1", started_at=datetime(2026, 10, 1, 20, 0), ended_at=datetime(2026, 10, 1, 21, 0))
    db.add(s)
    db.flush()
    events = [{"t": 1.0, "kind": "load", "channel": "A", "trackId": 7, "bpm": 128},
              {"t": 2.0, "kind": "transport", "channel": "A", "action": "play", "playhead": 0}]
    scratch = {"t": 1.5, "kind": "transport", "channel": "A", "action": "scratchMove", "playhead": 0}
    db.add(SessionChunk(session_id=s.id, seq=0, events_json=json.dumps(events[:1] + [scratch])))
    db.add(SessionChunk(session_id=s.id, seq=1, events_json=json.dumps(events[1:])))
    db.commit()

    rows = client.get("/api/device-sync/sessions").json()
    assert [r["uuid"] for r in rows] == ["s-1"]
    assert rows[0]["take_count"] == 0 and rows[0]["ended_at"].startswith("2026-10-01T21:00")

    detail = client.get("/api/device-sync/sessions/s-1").json()
    assert detail["events"] == events
    assert client.get("/api/device-sync/sessions/missing").status_code == 404


def test_stems_rev_and_stem_endpoints(client, make_track, tmp_path, monkeypatch):
    from backend import config as config_module
    from backend.config import StemsConfig
    from tests.test_stems_router import materialize_stems

    stems = StemsConfig(directory=str(tmp_path / "stems"))
    monkeypatch.setattr(config_module.get_config(), "stems", stems)
    source = tmp_path / "a.mp3"
    source.write_bytes(b"x" * 500)
    track = make_track(filename=str(source))
    bare = make_track(filename=str(tmp_path / "missing.mp3"))
    materialize_stems(track.id, source, stems)

    rows = {t["id"]: t for t in client.get("/api/device-sync/snapshot").json()["tracks"]}
    rev = rows[track.id]["stems_rev"]
    assert rev and rows[bare.id]["stems_rev"] is None

    r = client.get(f"/api/device-sync/tracks/{track.id}/stems/drums")
    assert r.status_code == 200 and r.headers["x-stems-rev"] == rev
    assert client.get(f"/api/device-sync/tracks/{track.id}/stems/drums", headers={"Range": "bytes=0-9"}).status_code == 206
    assert client.get(f"/api/device-sync/tracks/{track.id}/stems/guitar").status_code == 404
    assert client.get(f"/api/device-sync/tracks/{bare.id}/stems/drums").status_code == 404

    source.write_bytes(b"y" * 600)  # replaced audio: stems are stale = absent
    rows = {t["id"]: t for t in client.get("/api/device-sync/snapshot").json()["tracks"]}
    assert rows[track.id]["stems_rev"] is None
    assert client.get(f"/api/device-sync/tracks/{track.id}/stems/drums").status_code == 404


def test_snapshot_bpm_centi_is_the_gate_column(client, make_track):
    track = make_track()
    track.bpm = 17412
    rows = {t["id"]: t for t in client.get("/api/device-sync/snapshot").json()["tracks"]}
    assert rows[track.id]["bpm_centi"] == 17412


def _audible_chunk():
    return [{"t": 1.0, "kind": "load", "channel": "A", "trackId": 7, "bpm": 128},
            {"t": 2.0, "kind": "transport", "channel": "A", "action": "play", "playhead": 0}]


def test_phone_session_push_is_idempotent_and_resumable(client, db):
    """#395: phone Sessions land as ordinary Sessions with an origin; re-pushes add only unseen chunks."""
    headers = {"X-Manadj-Device-Id": "dev-1", "X-Manadj-Device-Name": "Pixel"}
    body = {"started_at": "2026-10-15T07:00:00", "chunks": [{"seq": 0, "events": _audible_chunk()}]}
    r = client.post("/api/device-sync/sessions/p-1", json=body, headers=headers)
    assert r.status_code == 200 and r.json()["stored_seqs"] == [0]
    # Retry of the same chunk + a new one + the end: only seq 1 is new.
    tick = [{"t": 3.0, "kind": "tick", "playheads": {"A": 1.0}}]
    body = {"started_at": "2026-10-15T07:00:00", "ended_at": "2026-10-15T07:30:00",
            "chunks": [{"seq": 0, "events": _audible_chunk()}, {"seq": 1, "events": tick}]}
    assert client.post("/api/device-sync/sessions/p-1", json=body, headers=headers).json()["stored_seqs"] == [0, 1]
    rows = client.get("/api/device-sync/sessions").json()
    assert rows[0]["uuid"] == "p-1" and rows[0]["origin"] == "Pixel"
    assert rows[0]["ended_at"].startswith("2026-10-15T07:30")
    assert client.get("/api/device-sync/sessions/p-1").json()["events"] == _audible_chunk() + tick


def test_phone_session_push_never_touches_a_desktop_session(client, db):
    from backend.models import Session as SessionRow

    db.add(SessionRow(uuid="d-1", started_at=datetime(2026, 10, 1)))
    db.commit()
    body = {"started_at": "2026-10-15T07:00:00", "chunks": [{"seq": 0, "events": _audible_chunk()}]}
    assert client.post("/api/device-sync/sessions/d-1", json=body).status_code == 409


def test_silent_phone_session_is_dropped_on_end(client, db):
    from backend.models import Session as SessionRow

    silent = [{"t": 1.0, "kind": "load", "channel": "A", "trackId": 7, "bpm": 128}]
    body = {"started_at": "2026-10-15T07:00:00", "ended_at": "2026-10-15T07:01:00", "chunks": [{"seq": 0, "events": silent}]}
    r = client.post("/api/device-sync/sessions/p-2", json=body)
    assert r.status_code == 200 and r.json()["deleted"] is True
    assert db.query(SessionRow).filter(SessionRow.uuid == "p-2").first() is None

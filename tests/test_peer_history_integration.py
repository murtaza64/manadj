"""Task61: normal history must resolve immutable peer evidence, never foreign/reused IDs."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
import io
import json
import os
import struct
import subprocess
import sys
import wave

import pytest

from backend.database import get_db
from backend.routers.sessions import router as history_router
from tests import test_peer_session_exchange as exchange
from tests.test_peer_session_exchange import bind, export, post, seed, setup_pair


@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def history(peer):
    app = FastAPI()
    app.include_router(history_router, prefix="/api/sessions")

    def database():
        with peer.sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    return TestClient(app)


def test_exchange_materializes_normal_history_with_receiver_refs_and_survives_restart(instance):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    post(b, "imports", packet)
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    bind(b, 9, logical)
    result = post(b, f"sessions/{sid}/materialize")
    assert result["session_uuid"] == sid
    normal = history(b)
    assert [row["uuid"] for row in normal.get("/api/sessions").json()] == [sid]
    detail = normal.get(f"/api/sessions/{sid}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["events"][0]["trackId"] == 9
    restarted = instance("b")
    assert history(restarted).get(f"/api/sessions/{sid}").json() == detail.json()
    assert post(restarted, f"sessions/{sid}/materialize")["duplicate"] is True


def test_unknown_missing_or_reused_tracks_never_become_playable_normal_history(instance):
    from backend.models import Session, Track
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    post(b, "imports", packet)
    post(b, f"sessions/{sid}/materialize", status=409)
    with b.sessions() as db:
        assert db.query(Session).count() == 0
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    bind(b, 9, logical)
    post(b, f"sessions/{sid}/materialize")
    (b.root / "generated.wav").unlink()
    assert history(b).get(f"/api/sessions/{sid}").status_code == 409
    with b.sessions() as db:
        db.delete(db.get(Track, 9))
        db.commit()
    seed(b, 9, filename="unrelated-reused.wav")
    assert history(b).get(f"/api/sessions/{sid}").status_code == 409


def materialized(instance):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    post(b, "imports", packet)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    post(b, f"sessions/{sid}/materialize")
    return a, b, sid, packet


def test_peer_mutations_retries_recovery_and_projection_delete(instance):
    from backend.models import Session, SessionChunk
    from backend.peer_sync.models import SyncSession
    from backend.routers.device_sync import router as device_router
    a, b, sid, packet = materialized(instance)
    normal = history(b)
    normal.app.include_router(device_router, prefix="/api/device-sync")
    assert normal.post(f"/api/sessions/{sid}/chunks", json={"seq": 0, "events": []}).status_code == 409
    assert normal.patch(f"/api/sessions/{sid}/end", json={}).status_code == 409
    assert normal.post(f"/api/device-sync/sessions/{sid}", json={
        "started_at": "2026-01-01T00:00:00", "chunks": [{"seq": 0, "events": []}],
    }).status_code == 409
    assert normal.get(f"/api/device-sync/sessions/{sid}").status_code == 409
    assert post(b, "imports", packet)["duplicate"] is True
    assert post(b, f"sessions/{sid}/materialize")["duplicate"] is True
    (b.root / "generated.wav").unlink()
    assert normal.post("/api/sessions/recover").json() == {"closed": 0, "deleted": 0}
    with b.sessions() as db:
        assert db.query(Session).count() == 1
        assert db.query(SessionChunk).count() == 0
        assert db.get(SyncSession, sid).manifest_json
        from backend.tasks.models import Task
        assert db.query(Task).filter(Task.type == "routine-mine").count() == 1
    assert normal.delete(f"/api/sessions/{sid}").status_code == 200
    with b.sessions() as db:
        assert db.query(Session).count() == 0
        assert db.get(SyncSession, sid) is not None  # immutable evidence survives unmaterialize


@pytest.mark.parametrize("site", ["t", "bpm", "trackId", "playhead"])
def test_huge_integer_is_422_not_500(instance, site):
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid)
    index = 1 if site == "playhead" else 0
    packet["chunks"][0]["events"][index][site] = 10 ** 400
    post(b, "imports", packet, status=422)
    from backend.peer_sync.models import SyncSession
    with b.sessions() as db:
        assert db.query(SyncSession).count() == 0


@pytest.mark.parametrize("state", ["unknown", "partial", "changed", "missing", "incomplete"])
def test_unready_materialize_is_atomic(instance, state):
    from backend.models import Session
    a, b, _, _, sid = setup_pair(instance)
    packet = export(a, sid, fingerprint_assets=state != "unknown")
    if state == "incomplete":
        packet["chunks"] = packet["chunks"][:1]
    post(b, "imports", packet)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    path = b.root / "generated.wav"
    if state == "partial":
        path.write_bytes(b"short")
    elif state == "changed":
        path.write_bytes(b"x" * path.stat().st_size)
    elif state == "missing":
        path.unlink()
    post(b, f"sessions/{sid}/materialize", status=409)
    with b.sessions() as db:
        assert db.query(Session).count() == 0


def test_current_incarnation_required_then_explicit_rematerialization_invalidates_candidates(instance):
    from backend.models import RoutineCandidate, Session, Track
    a, b, sid, packet = materialized(instance)
    normal = history(b)
    first = normal.get(f"/api/sessions/{sid}").json()
    logical = packet["manifest"]["tracks"][0]["logical_track_id"]
    with b.sessions() as db:
        db.add(RoutineCandidate(uuid="old-candidate", session_uuid=sid, entry_track_id=9, exit_track_id=9,
            cast_json="[9]", window_start_s=0, window_end_s=10, entry_offsets_json="[0]", evidence_json="{}", miner_version=1))
        db.delete(db.get(Track, 9))
        db.commit()
    seed(b, 9)  # same ID/path/bytes; NEW incarnation, no selection or logical binding
    assert normal.get(f"/api/sessions/{sid}").status_code == 409
    bind(b, 9, logical)
    assert normal.get(f"/api/sessions/{sid}").status_code == 409  # explicit binding alone cannot reuse a mined generation
    assert post(b, f"sessions/{sid}/materialize")["duplicate"] is False
    second = normal.get(f"/api/sessions/{sid}").json()
    assert second["events"] == first["events"]
    assert second["replay_generation"] != first["replay_generation"]
    with b.sessions() as db:
        assert db.query(RoutineCandidate).count() == 0
        assert db.query(Session).one().routine_miner_version is None
    assert normal.get(f"/api/sessions/{sid}/audio/9", params={"generation": first["replay_generation"]}).status_code == 409


def test_generated_wav_normal_reader_versioned_audio_and_fresh_process_restart(instance):
    a, b, _, _, sid = setup_pair(instance)
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(struct.pack("<80h", *([1000, -1000] * 40)) * 100)
    data = stream.getvalue()
    for peer in (a, b):
        (peer.root / "generated.wav").write_bytes(data)
    packet = export(a, sid)
    post(b, "imports", packet)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    post(b, f"sessions/{sid}/materialize")
    normal = history(b)
    detail = normal.get(f"/api/sessions/{sid}").json()
    generation = detail["replay_generation"]
    audio = normal.get(f"/api/sessions/{sid}/audio/9", params={"generation": generation})
    assert audio.status_code == 200 and audio.content == data
    with wave.open(io.BytesIO(audio.content)) as wav:
        assert wav.getnframes() == 8000
        assert wav.readframes(1) == struct.pack("<h", 1000)
    assert normal.get(f"/api/sessions/{sid}/audio/1", params={"generation": generation}).status_code == 409
    probe = subprocess.run([sys.executable, "-c", """
import hashlib, json, os, sys
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from backend.database import apply_sqlite_pragmas
from backend.routers.sessions import get_session, get_peer_audio
engine = create_engine(sys.argv[1])
event.listen(engine, 'connect', apply_sqlite_pragmas)
with Session(engine) as db:
    detail = get_session(sys.argv[2], db)
    audio = get_peer_audio(sys.argv[2], 9, detail.replay_generation, db)
    print(json.dumps({'pid': os.getpid(), 'detail': detail.model_dump(mode='json'), 'audio_hash': hashlib.sha256(audio.body).hexdigest()}))
""", str(b.engine.url), sid], check=True, capture_output=True, text=True)
    result = json.loads(probe.stdout)
    assert result["pid"] != os.getpid() and result["detail"] == detail
    assert result["audio_hash"] == packet["manifest"]["tracks"][0]["asset"]["sha256"]
    # A path swap after validation cannot return unchecked bytes.
    (b.root / "generated.wav").write_bytes(b"x" * len(data))
    assert normal.get(f"/api/sessions/{sid}/audio/9", params={"generation": generation}).status_code == 409


def test_real_miner_preview_and_video_read_mapped_source_and_block_stale_cast(instance):
    from backend.models import Playlist, PlaylistTrack, RoutineCandidate, Session, SessionChunk
    from backend.routers import routine_candidates, routine_takes, video_export
    from backend.routine_miner_tasks import replace_session_candidates
    from tests.test_routine_miner import weave_events
    a, b, _, _, sid = setup_pair(instance)
    for source_id, receiver_id in ((2, 8), (3, 7)):
        seed(a, source_id, filename=f"source-{source_id}.wav")
        guard = post(a, f"tracks/{source_id}/select")["guard"]
        post(a, f"tracks/{source_id}/identify", {"guard": guard})
        seed(b, receiver_id, filename=f"receiver-{receiver_id}.wav")
    events = sorted(weave_events(1, 2, 3), key=lambda e: e["t"])
    loaded_at = {"A": 5, "B": 30, "C": 72}
    for e in events:
        if e["kind"] == "transport":
            e["playhead"] = e["t"] - loaded_at[e["channel"]]
    with a.sessions() as db:
        s = db.query(Session).filter(Session.uuid == sid).one()
        db.query(SessionChunk).filter(SessionChunk.session_id == s.id).delete()
        db.add(SessionChunk(session_id=s.id, seq=0, events_json=json.dumps(events)))
        db.commit()
    packet = export(a, sid)
    post(b, "imports", packet)
    for ref in packet["manifest"]["tracks"]:
        bind(b, {1: 9, 2: 8, 3: 7}[ref["source_local_id"]], ref["logical_track_id"])
    post(b, f"sessions/{sid}/materialize")
    with b.sessions() as db:
        playlist = Playlist(name="Receiver order")
        db.add(playlist)
        db.flush()
        for index, tid in enumerate([9, 8, 7]):
            db.add(PlaylistTrack(playlist_id=playlist.id, track_id=tid, position=index))
        db.commit()
        assert replace_session_candidates(db, db.query(Session).filter(Session.uuid == sid).one()) == 1
        db.commit()
        candidate = db.query(RoutineCandidate).one()
        cid = candidate.uuid
        assert json.loads(candidate.cast_json) == [9, 8, 7]
    normal = history(b)
    for router, prefix in ((routine_candidates.router, "routine-candidates"), (routine_takes.router, "routine-takes"), (video_export.router, "video-export")):
        normal.app.include_router(router, prefix=f"/api/{prefix}")
    preview = normal.get(f"/api/routine-candidates/{cid}/preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["cast"] == [9, 8, 7]
    assert preview.json()["peer_source"]["session_uuid"] == sid
    span = normal.get(f"/api/video-export/session-span/{sid}", params={"start_s": 27, "end_s": 83})
    assert span.status_code == 200, span.text
    assert span.json()["cast"] == [9, 8, 7]
    assert span.json()["peer_source"] == preview.json()["peer_source"]
    assert normal.post("/api/routine-takes", json={
        "uuid": "unsupported-derived", "session_uuid": sid, "cast": [9, 8, 7],
        "window_start_s": 27, "window_end_s": 83, "entry_offsets": [0, 3, 45],
    }).status_code == 409
    (b.root / "generated.wav").unlink()
    assert normal.get("/api/routine-candidates").status_code == 409
    assert normal.get(f"/api/routine-candidates/{cid}/preview").status_code == 409
    assert normal.get(f"/api/video-export/session-span/{sid}", params={"start_s": 27, "end_s": 83}).status_code == 409
    from fastapi import HTTPException
    with b.sessions() as db:
        with pytest.raises(HTTPException) as error:
            replace_session_candidates(db, db.query(Session).filter(Session.uuid == sid).one())
        assert error.value.status_code == 409

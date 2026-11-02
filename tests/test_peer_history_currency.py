"""Regression for independent QA's miner publish/rematerialize interleave."""
import json

import pytest
from fastapi import HTTPException

from tests import test_peer_session_exchange as exchange
from tests.test_peer_history_integration import history
from tests.test_peer_session_exchange import bind, export, post, seed, setup_pair


@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def mining_peer(instance):
    from backend.models import Playlist, PlaylistTrack, Session, SessionChunk
    from tests.test_routine_miner import weave_events
    a, b, _, _, sid = setup_pair(instance)
    for source, receiver in ((2, 8), (3, 7)):
        seed(a, source, filename=f"source-{source}.wav")
        guard = post(a, f"tracks/{source}/select")["guard"]
        post(a, f"tracks/{source}/identify", {"guard": guard})
        seed(b, receiver, filename=f"receiver-{receiver}.wav")
    events = sorted(weave_events(1, 2, 3), key=lambda event: event["t"])
    for event in events:
        if event["kind"] == "transport":
            event["playhead"] = event["t"] - {"A": 5, "B": 30, "C": 72}[event["channel"]]
    with a.sessions() as db:
        recorded = db.query(Session).filter_by(uuid=sid).one()
        db.query(SessionChunk).filter_by(session_id=recorded.id).delete()
        db.add(SessionChunk(session_id=recorded.id, seq=0, events_json=json.dumps(events)))
        db.commit()
    packet = export(a, sid)
    post(b, "imports", packet)
    refs = {ref["source_local_id"]: ref["logical_track_id"] for ref in packet["manifest"]["tracks"]}
    for source, receiver in ((1, 9), (2, 8), (3, 7)):
        bind(b, receiver, refs[source])
    post(b, f"sessions/{sid}/materialize")
    with b.sessions() as db:
        playlist = Playlist(name="Generated receiver order")
        db.add(playlist)
        db.flush()
        for index, track_id in enumerate([9, 8, 7]):
            db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track_id, position=index))
        db.commit()
    return b, sid, refs


def test_concurrent_rematerialization_prevents_old_candidate_publication(instance, monkeypatch):
    from backend import routine_miner_tasks
    from backend.models import PlaylistTrack, RoutineCandidate, Session, Track
    b, sid, refs = mining_peer(instance)
    original = routine_miner_tasks.mine_session

    def interleaved_mine(events, orderings):
        with b.sessions() as db:
            db.query(PlaylistTrack).filter_by(track_id=9).delete()
            db.delete(db.get(Track, 9))
            db.commit()
        seed(b, 9, filename="unrelated-reused-nine.wav")
        seed(b, 10, filename="new-explicit-binding.wav")
        bind(b, 10, refs[1])
        post(b, f"sessions/{sid}/materialize")
        return original(events, orderings)

    monkeypatch.setattr(routine_miner_tasks, "mine_session", interleaved_mine)
    with b.sessions() as db:
        with pytest.raises(HTTPException, match="peer_mining_generation_changed"):
            routine_miner_tasks.replace_session_candidates(db, db.query(Session).filter_by(uuid=sid).one())
        db.rollback()
    with b.sessions() as db:
        assert db.query(RoutineCandidate).filter_by(session_uuid=sid).count() == 0
        assert db.query(Session).filter_by(uuid=sid).one().routine_miner_version is None
    assert history(b).get(f"/api/sessions/{sid}").json()["events"][0]["trackId"] == 10


def test_candidate_provenance_guards_list_query_preview_and_valid_mine(instance):
    from backend.models import RoutineCandidate, Session
    from backend.routine_miner_tasks import replace_session_candidates
    from backend.routers.routine_candidates import router
    from backend.session_source import replay_generation
    b, sid, _ = mining_peer(instance)
    with b.sessions() as db:
        recorded = db.query(Session).filter_by(uuid=sid).one()
        assert replace_session_candidates(db, recorded) > 0
        db.commit()
        candidate = db.query(RoutineCandidate).filter_by(session_uuid=sid).first()
        assert candidate.peer_generation == replay_generation(recorded)
        candidate_id = candidate.uuid
    client = history(b)
    client.app.include_router(router, prefix="/api/routine-candidates")
    assert client.get("/api/routine-candidates", params={"session_uuid": sid}).status_code == 200
    with b.sessions() as db:
        db.query(RoutineCandidate).filter_by(uuid=candidate_id).update({"peer_generation": "0" * 64})
        db.commit()
    assert client.get("/api/routine-candidates", params={"session_uuid": sid}).status_code == 409
    assert client.post("/api/routine-candidates/query", json={"track_ids": [9, 8, 7]}).status_code == 409
    assert client.get(f"/api/routine-candidates/{candidate_id}/preview").status_code == 409

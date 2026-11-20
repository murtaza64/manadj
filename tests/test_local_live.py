from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.local_live import LiveMailbox, LiveAnchor, reader, publisher
from backend.device_listener import build_app


def body(stream=None, seq=0):
    return dict(stream_id=str(stream or uuid4()), seq=seq, unsupported=[], decks=[dict(
        track_id=None, position=0, playing=False, pitch=0, bend=0, fader=.7, trim=.5,
        low=.5, mid=.5, high=.5, filter=0, key_lock=False, unsupported=[])] * 4)


def test_finite_bounded_complete_decks():
    LiveAnchor.model_validate(body())
    for bad in [float('nan'), float('inf'), -1]:
        payload = body(); payload['decks'][0]['position'] = bad
        with pytest.raises(ValueError):
            LiveAnchor.model_validate(payload)
    payload = body(); payload['decks'].pop()
    with pytest.raises(ValueError): LiveAnchor.model_validate(payload)


def test_order_source_replacement_stop_and_expiry():
    clock = [10.0]
    store = LiveMailbox(lambda: clock[0])
    one = body(); store.publish(one)
    assert store.read()['state'] == 'live'
    with pytest.raises(HTTPException): store.publish(one)
    with pytest.raises(HTTPException): store.publish(body())
    store.stop(str(uuid4())); assert store.read()['state'] == 'live'
    clock[0] += 2.01
    assert store.read()['state'] == 'offline'
    two = body(); store.publish(two)
    store.stop(two['stream_id']); assert store.read()['state'] == 'offline'


def test_paired_reader_only_and_no_publisher_on_lan():
    client = TestClient(build_app(lambda: 'AAAAA-BBBBB'))
    assert client.get('/api/device-sync/live').status_code == 401
    assert client.get('/api/device-sync/live', headers={'X-Manadj-Pair':'AAAAA-BBBBB'}).status_code == 200
    assert client.post('/api/local-live/anchor', headers={'X-Manadj-Pair':'AAAAA-BBBBB'}, json=body()).status_code == 404


def test_publisher_refuses_non_loopback_before_db_use():
    app=FastAPI(); app.include_router(publisher, prefix='/api/local-live')
    client=TestClient(app, client=('192.0.2.9', 2000))
    assert client.post('/api/local-live/anchor',json=body()).status_code == 403


def test_real_desktop_publisher_revisions_and_paired_reader_stop(db, make_track, tmp_path, monkeypatch):
    from backend.main import app
    from backend.database import get_db
    from backend import local_live
    from backend.routers.device_sync import audio_rev
    monkeypatch.setattr(local_live, 'mailbox', LiveMailbox())
    audio = tmp_path / 'synthetic.wav'
    audio.write_bytes(b'RIFF-synthetic-test-data')
    track = make_track(filename=str(audio))
    app.dependency_overrides[get_db] = lambda: db
    try:
        desktop = TestClient(app)
        phone = TestClient(build_app(lambda: 'AAAAA-BBBBB'))
        payload = body()
        payload['decks'][0]['track_id'] = track.id
        response = desktop.post('/api/local-live/anchor', json=payload)
        assert response.status_code == 200, response.text
        result = phone.get('/api/device-sync/live', headers={'X-Manadj-Pair':'AAAAA-BBBBB'})
        assert result.status_code == 200
        assert result.json()['anchor']['decks'][0]['audio_rev'] == audio_rev(str(audio))
        assert result.json()['anchor']['seq'] == 0
        assert not db.dirty and not db.new
        assert desktop.delete('/api/local-live/' + payload['stream_id']).status_code == 200
        assert phone.get('/api/device-sync/live', headers={'X-Manadj-Pair':'AAAAA-BBBBB'}).json()['state'] == 'offline'
    finally:
        app.dependency_overrides.pop(get_db, None)

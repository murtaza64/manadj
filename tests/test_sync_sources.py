from types import SimpleNamespace as Row
from backend.routers import sync_sources
from backend.sync_status.models import SurfaceTrackRef, TrackFields


def test_desktop_inventory_includes_unplaylisted_tracks_and_marks_path_only(db, make_track, monkeypatch):
    track = make_track(filename='/music/one.mp3', title='Library One')
    refs = [SurfaceTrackRef('/music/one.mp3', TrackFields(title='Source One', artist='A')),
            SurfaceTrackRef('/music/unplaylisted.mp3', TrackFields(title='Outside playlists'))]
    monkeypatch.setattr(sync_sources, 'read_source', lambda source, path: refs)
    result = sync_sources.inventory('engine', '/desktop/Database2', db)
    assert result['status'] == 'read'
    assert len(result['tracks']) == 2
    assert result['tracks'][0]['library_track_id'] == track.id
    assert result['tracks'][0]['match'] == 'same-path'
    assert result['tracks'][1]['match'] == 'not-in-library'
    assert 'not verified' in result['match_basis']
    assert db.get(type(track), track.id).title == 'Library One'


def test_unconfigured_and_failed_are_not_empty_success(db, monkeypatch):
    monkeypatch.setattr(sync_sources, 'read_source', lambda *_: (_ for _ in ()).throw(RuntimeError('private path')))
    assert sync_sources.inventory('rekordbox', None, db)['status'] == 'not_configured'
    result = sync_sources.inventory('rekordbox', '/missing', db)
    assert result['status'] == 'failed' and result['tracks'] == []
    assert result['reason'] == 'RuntimeError'
    assert 'private' not in str(result)


def test_case_only_path_does_not_claim_identity(db, make_track, monkeypatch):
    make_track(filename='/Music/A.mp3')
    monkeypatch.setattr(sync_sources, 'read_source', lambda *_: [SurfaceTrackRef('/music/a.mp3', TrackFields(title='A'))])
    assert sync_sources.inventory('rekordbox', '/desktop', db)['tracks'][0]['library_track_id'] is None


def test_engine_real_adapter_is_desktop_only_and_read_only(db, tmp_path):
    import hashlib
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from enginedj.base import Base
    from enginedj.models.track import Track
    from enginedj.models.information import Information
    # Synthetic schema only; no developer or user library files.
    path = tmp_path / 'Database2'
    path.mkdir()
    engine = create_engine(f"sqlite:///{path / 'm.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Information(uuid='synthetic', schemaVersionMajor=3, schemaVersionMinor=0, schemaVersionPatch=1))
        session.add(Track(id=1, title='Unplaylisted desktop track', path='/synthetic/a.mp3', filename='a.mp3'))
        session.commit()
    engine.dispose()
    before = hashlib.sha256((path / 'm.db').read_bytes()).hexdigest()
    result = sync_sources.inventory('engine', str(path), db)
    assert result['status'] == 'read'
    assert [row['title'] for row in result['tracks']] == ['Unplaylisted desktop track']
    assert hashlib.sha256((path / 'm.db').read_bytes()).hexdigest() == before

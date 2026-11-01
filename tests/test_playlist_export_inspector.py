from backend.models import Playlist, PlaylistTrack, Track
from backend.sync_status.models import HotCueValue, SurfaceTrackRef, TrackFields


def test_plan_names_destructive_effects_and_unknowns_without_writing(db):
    from backend.playlist_export_inspector import DestinationSnapshot, PlaylistExportInspector

    a = Track(filename='/fixture/a.flac', title='A', energy=None)
    b = Track(filename='/fixture/b.flac', title='B', key=8)
    playlist = Playlist(name='Set')
    db.add_all([a, b, playlist])
    db.flush()
    db.add_all([PlaylistTrack(playlist_id=playlist.id, track_id=a.id, position=0),
                PlaylistTrack(playlist_id=playlist.id, track_id=b.id, position=1)])
    db.commit()
    snapshot = DestinationSnapshot(
        identity='/fixture/rekordbox',
        playlist=['/fixture/b.flac', '/fixture/a.flac', '/fixture/removed.flac'],
        tracks=[SurfaceTrackRef('/fixture/a.flac', TrackFields(
            energy=4, hotcues=[HotCueValue(1, 2.0)], tags=['old'])),
                SurfaceTrackRef('/fixture/b.flac', TrackFields(key=7))],
        known_fields={'energy', 'hotcues', 'tags', 'key'},
        revision='fixture-v1',
    )
    writes = []
    inspector = PlaylistExportInspector(db, lambda name, target: snapshot,
                                       lambda *args: writes.append(args))
    plan = inspector.preview('Set', 'rekordbox', 'full')
    assert writes == []
    assert plan['membership']['removed'] == ['/fixture/removed.flac']
    assert plan['membership']['after'] == ['/fixture/a.flac', '/fixture/b.flac']
    assert plan['membership']['moved'] == 2
    fields = {f['field']: f for f in plan['tracks'][0]['fields']}
    assert fields['energy']['action'] == 'clear'
    assert fields['energy']['before'] == 4
    assert fields['hotcues']['action'] == 'clear'
    assert fields['hotcues']['before'][0]['time'] == 2.0
    assert fields['maincue']['before_known'] is False
    assert fields['memorycues']['before_known'] is False
    assert fields['memorycues']['action'] == 'clear'
    assert fields['beatgrid']['action'] == 'skip'
    assert plan['token']
    assert plan['executable'] is True


def test_execute_rejects_changed_source_destination_scope_and_blocked_records(db):
    import pytest
    from backend.playlist_export_inspector import DestinationSnapshot, PlaylistExportInspector, StalePlan, PlanUnavailable

    track = Track(filename='/fixture/a.flac', title='A', key=1)
    playlist = Playlist(name='Set')
    db.add_all([track, playlist])
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    snapshot = DestinationSnapshot('fixture', [], [SurfaceTrackRef(track.filename, TrackFields())], set(), 'v1')
    writes = []
    inspector = PlaylistExportInspector(db, lambda *args: snapshot, lambda *args: writes.append(args) or {'ok': True})
    token = inspector.preview('Set', 'rekordbox', 'full')['token']
    with pytest.raises(StalePlan):
        inspector.execute('Set', 'rekordbox', 'order', token)
    track.key = 2
    db.commit()
    with pytest.raises(StalePlan):
        inspector.execute('Set', 'rekordbox', 'full', token)
    token = inspector.preview('Set', 'rekordbox', 'full')['token']
    snapshot.revision = 'v2'
    with pytest.raises(StalePlan):
        inspector.execute('Set', 'rekordbox', 'full', token)
    snapshot.tracks = []
    plan = inspector.preview('Set', 'rekordbox', 'full')
    assert plan['tracks'][0]['record_action'] == 'blocked'
    assert plan['executable'] is False
    with pytest.raises(PlanUnavailable):
        inspector.execute('Set', 'rekordbox', 'full', plan['token'])
    assert writes == []
    snapshot.tracks = [SurfaceTrackRef('/fixture/a.flac', TrackFields())]
    token = inspector.preview('Set', 'rekordbox', 'order')['token']
    assert inspector.execute('Set', 'rekordbox', 'order', token) == {'ok': True}
    assert writes == [('Set', 'rekordbox', 'order', 'fixture')]


def test_api_requires_exact_plan_and_returns_real_partial_field_receipt(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.export_gate import require_export_enabled
    from backend.routers.sync_export import router, get_playlist_export_inspector
    from backend.playlist_export_inspector import DestinationSnapshot, PlaylistExportInspector, ExportInProgress

    track = Track(filename='/fixture/a.flac', title='A')
    playlist = Playlist(name='A / B')
    db.add_all([track, playlist])
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    snapshot = DestinationSnapshot('fixture', [], [SurfaceTrackRef(track.filename, TrackFields())], set(), 'v1')
    calls = []
    inspector = None

    def write(*args):
        calls.append(args)
        # Concurrent/double-submit exclusion through the public operation.
        import pytest
        with pytest.raises(ExportInProgress):
            inspector.execute('A / B', 'rekordbox', 'full', token)
        return {'results': [{'target': 'rekordbox', 'status': 'partial', 'tracks': [
            {'track_id': track.id, 'status': 'exported', 'fields': {
                'hotcues': 'exported', 'beatgrid': 'skipped: native analysis missing'}}]}]}

    inspector = PlaylistExportInspector(db, lambda *args: snapshot, write)
    app = FastAPI()
    app.include_router(router, prefix='/api')
    app.dependency_overrides[get_playlist_export_inspector] = lambda: inspector
    app.dependency_overrides[require_export_enabled] = lambda: None
    client = TestClient(app)
    params = {'playlist': 'A / B', 'target': 'rekordbox', 'scope': 'full'}
    plan = client.get('/api/sync/export/playlists/plan', params=params)
    assert plan.status_code == 200
    token = plan.json()['token']
    response = client.post('/api/sync/export/playlists/execute', params={'playlist': 'A / B'},
                           json={'target': 'engine', 'scope': 'full', 'token': token})
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'stale_plan'
    assert calls == []
    response = client.post('/api/sync/export/playlists/execute', params={'playlist': 'A / B'},
                           json={'target': 'rekordbox', 'scope': 'full', 'token': token})
    assert response.status_code == 200
    assert calls == [('A / B', 'rekordbox', 'full', 'fixture')]
    assert response.json()['results'][0]['tracks'][0]['fields']['beatgrid'].startswith('skipped:')


def test_destination_specific_blank_policy_and_ambiguous_playlist_are_explicit(db):
    import pytest
    from backend.playlist_export_inspector import DestinationSnapshot, PlaylistExportInspector, PlanUnavailable

    track = Track(filename='/fixture/a.flac', title='A', energy=None)
    playlist = Playlist(name='Set')
    db.add_all([track, playlist])
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    snapshot = DestinationSnapshot('fixture', None, [SurfaceTrackRef(track.filename, TrackFields(energy=5, tags=['foreign']))], {'energy', 'tags'}, 'v1')
    inspector = PlaylistExportInspector(db, lambda *args: snapshot, lambda *args: None)
    rb = inspector.preview('Set', 'rekordbox', 'full')
    engine = inspector.preview('Set', 'engine', 'full')
    rb_fields = {f['field']: f for f in rb['tracks'][0]['fields']}
    engine_fields = {f['field']: f for f in engine['tracks'][0]['fields']}
    assert rb_fields['energy']['action'] == 'clear'
    assert engine_fields['energy']['action'] == 'skip'
    assert engine_fields['tags']['after'] == ['foreign']
    assert rb_fields['tags']['after'] == []
    assert rb['membership']['create'] is True
    assert rb['membership']['added'] == ['/fixture/a.flac']
    track.cue_point_time = 9.5
    db.commit()
    memory = next(f for f in inspector.preview('Set', 'rekordbox', 'full')['tracks'][0]['fields'] if f['field'] == 'memorycues')
    assert memory['after'] == [9.5]
    assert memory['action'] == 'replace-unknown'
    db.add(Playlist(name='Set'))
    db.commit()
    with pytest.raises(PlanUnavailable, match='ambiguous'):
        inspector.preview('Set', 'rekordbox', 'full')


def test_export_gate_runs_before_any_inspector_execution():
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from backend.export_gate import require_export_enabled
    from backend.routers.sync_export import router, get_playlist_export_inspector

    class FixtureInspector:
        def execute(self, *args):
            raise AssertionError('A disabled export must not reach execution')

    def disabled():
        raise HTTPException(403, 'Export off')

    app = FastAPI()
    app.include_router(router, prefix='/api')
    app.dependency_overrides[get_playlist_export_inspector] = FixtureInspector
    app.dependency_overrides[require_export_enabled] = disabled
    response = TestClient(app).post('/api/sync/export/playlists/execute?playlist=Set',
                                    json={'target': 'rekordbox', 'scope': 'full', 'token': 'old'})
    assert response.status_code == 403


def test_full_export_factory_uses_only_the_validated_destination_not_later_config(db, monkeypatch):
    from backend import playlist_full_export

    track = Track(filename='/fixture/a.flac', title='A')
    playlist = Playlist(name='Set')
    db.add_all([track, playlist])
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    observed = []

    class FixtureWriter:
        target = 'rekordbox'

        def __init__(self, session, connection, path):
            observed.append(str(path))

        def prepare(self, tracks):
            pass

        def replace_playlist(self, name, tracks):
            return False, {}

        def export_track(self, track):
            return {'key': 'exported'}

    monkeypatch.setattr(playlist_full_export, 'RekordboxPlaylistWriter', FixtureWriter)
    monkeypatch.setattr('rekordbox.connection.get_rekordbox_db', lambda path: observed.append(str(path)))

    def no_config():
        raise AssertionError('A validated destination must not be retargeted by config')

    monkeypatch.setattr('backend.config.get_config', no_config)
    service = playlist_full_export.build_playlist_full_export_service(db, destination_paths={'rekordbox': '/fixture/validated'})
    receipt = service.export('Set', ['rekordbox'])
    assert observed == ['/fixture/validated', '/fixture/validated']
    assert receipt['results'][0]['target'] == 'rekordbox'
    assert receipt['results'][0]['tracks_exported'] == 1

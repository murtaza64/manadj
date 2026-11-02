"""Reader/writer consent identity on disposable Engine/Library/audio fixtures."""
# ruff: noqa: F811
from dataclasses import replace
import os
import shutil

import pytest

from backend.field_review import FieldReviewRequest, StaleFieldPlan
from backend.field_review_adapters import build_field_review
from backend.playlist_export_inspector import build_playlist_export_inspector
from enginedj.models.track import Track as EngineTrack
from enginedj.track_export import EngineTrackSpec, insert_track
from tests.test_playlist_export_integration import destinations  # noqa: F401
from tests.test_library_export_integration import production_adapters  # noqa: F401


@pytest.fixture
def duplicates(production_adapters, make_track, audio_file, tmp_path):
    silence = audio_file('flac', name='source.flac')
    paths = [tmp_path / 'first/same.flac', tmp_path / 'second/same.flac']
    state = production_adapters
    ids = []
    for path in paths:
        path.parent.mkdir()
        shutil.copyfile(silence, path)
    with state.engine.session_m_write() as db:
        for path, key in zip(paths, [1, 7]):
            ident = insert_track(db, EngineTrackSpec(path, path.parent.name), state.engine.database_path.parent)
            db.get(EngineTrack, ident).key = key
            ids.append(ident)
    track = make_track(filename=str(paths[0]), key=7)
    return state, track, paths, ids


@pytest.mark.parametrize('source_key', [1, 7, 9])
def test_reviewed_before_and_consent_describe_exact_row_written(db, duplicates, source_key):
    state, track, _paths, ids = duplicates
    track.key = source_key
    db.commit()
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    service = build_field_review(db)
    plan = service.preview(request)
    field = plan['tracks'][0]['fields'][0]
    assert field['before'] == 1
    assert field['action'] == ('skip' if source_key == 1 else 'consent')
    receipt = service.execute(request, plan['token'], [(track.id, 'key')] if source_key != 1 else [])
    assert receipt['tracks'][0]['fields'][0]['status'] == ('skipped' if source_key == 1 else 'applied')
    with state.engine.session_m() as target:
        assert [target.get(EngineTrack, ident).key for ident in ids] == [source_key, 7]


@pytest.mark.parametrize('storage', ['relative', 'absolute', 'mixed', 'backslash', 'dot'])
def test_field_and_playlist_observations_share_writer_paths(db, duplicates, storage):
    from backend.models import Playlist, PlaylistTrack
    from enginedj.playlist import create_or_update_playlist
    from enginedj.playlist_reader import EnginePlaylistReader
    from backend.sync_status.adapters import EngineSurfaceReader

    state, track, paths, ids = duplicates
    root = state.engine.database_path.parent
    with state.engine.session_m_write() as target:
        rows = [target.get(EngineTrack, ident) for ident in ids]
        for index, row in enumerate(rows):
            relative = os.path.relpath(paths[index], root)
            row.path = str(paths[index]) if storage == 'absolute' or storage == 'mixed' and index == 0 else relative
            if storage == 'backslash':
                row.path = row.path.replace('/', '\\')
            if storage == 'dot':
                row.path = './sub/../' + row.path
        create_or_update_playlist(target, 'Identity', 0, rows[:1], 'decoy-engine')
    # A source path with lexical dots must use the same exact-path tier too.
    track.filename = str(paths[0].parent / '..' / 'first' / 'same.flac')
    playlist = Playlist(name='Identity')
    db.add(playlist)
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    refs = EngineSurfaceReader(state.engine).list_tracks()
    assert [ref.path for ref in refs] == [str(path) for path in paths]
    assert EnginePlaylistReader(state.engine).get_all_playlists()[0].tracks[0].path == str(paths[0])
    inspector = build_playlist_export_inspector(db)
    plan = inspector.preview('Identity', 'engine', 'full')
    assert plan['membership']['before'] == plan['membership']['after'] == [str(paths[0])]
    assert next(f for f in plan['tracks'][0]['fields'] if f['field'] == 'key')['before'] == 1
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    service = build_field_review(db)
    field_plan = service.preview(request)
    assert field_plan['tracks'][0]['fields'][0]['before'] == 1
    service.execute(request, field_plan['token'], [(track.id, 'key')])
    with state.engine.session_m() as target:
        assert [target.get(EngineTrack, ident).key for ident in ids] == [7, 7]


def test_basename_fallback_policy_is_unchanged_and_consistent(db, duplicates):
    state, track, paths, ids = duplicates
    track.filename = str(paths[0].parent.parent / 'not-present/same.flac')
    track.key = 9
    db.commit()
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    service = build_field_review(db)
    plan = service.preview(request)
    assert plan['tracks'][0]['fields'][0]['before'] == 7  # Existing last-basename policy.
    service.execute(request, plan['token'], [(track.id, 'key')])
    with state.engine.session_m() as target:
        assert [target.get(EngineTrack, ident).key for ident in ids] == [1, 9]


@pytest.mark.parametrize('changed', ['path', 'identity'])
def test_freshness_binds_matched_record_even_when_values_and_revision_agree(db, duplicates, changed):
    _state, track, _paths, _ids = duplicates
    service = build_field_review(db)
    read = service.read
    snapshot = replace(read('engine', 'export'), revision='constant-fixture-revision')
    service.read = lambda *args: snapshot
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    plan = service.preview(request)
    matched = snapshot.tracks[0]
    if changed == 'identity':
        snapshot = replace(snapshot, tracks=[replace(matched, identity='replacement-row'), *snapshot.tracks[1:]])
    else:
        # Exact candidate disappears; basename fallback observes a different
        # row with the same reviewed key. File revision alone cannot bind it.
        snapshot = replace(snapshot, tracks=[replace(matched, path='/moved/same.flac')])
    with pytest.raises(StaleFieldPlan):
        service.execute(request, plan['token'], [(track.id, 'key')])


def test_playlist_token_binds_matched_engine_row_identity(db, duplicates):
    from backend.models import Playlist, PlaylistTrack
    from backend.playlist_export_inspector import StalePlan

    _state, track, _paths, _ids = duplicates
    playlist = Playlist(name='Fresh identity')
    db.add(playlist)
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    service = build_playlist_export_inspector(db)
    snapshot = replace(service.read(playlist.name, 'engine'), revision='constant-fixture-revision')
    service.read = lambda *args: snapshot
    plan = service.preview(playlist.name, 'engine', 'full')
    snapshot = replace(snapshot, tracks=[replace(snapshot.tracks[0], identity='replacement-row'), *snapshot.tracks[1:]])
    with pytest.raises(StalePlan):
        service.execute(playlist.name, 'engine', 'full', plan['token'])


def test_duplicate_canonical_paths_keep_deterministic_last_row_policy(db, duplicates):
    state, track, paths, ids = duplicates
    with state.engine.session_m_write() as target:
        # Distinct stored strings satisfy Engine's unique raw-path constraint
        # while describing the same canonical path.
        target.get(EngineTrack, ids[1]).path = str(paths[0])
    track.key = 9
    db.commit()
    service = build_field_review(db)
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    plan = service.preview(request)
    assert plan['tracks'][0]['fields'][0]['before'] == 7
    service.execute(request, plan['token'], [(track.id, 'key')])
    with state.engine.session_m() as target:
        assert [target.get(EngineTrack, ident).key for ident in ids] == [1, 9]


def test_configured_library_root_not_process_cwd_defines_identity(db, duplicates, monkeypatch, tmp_path):
    _state, track, _paths, _ids = duplicates
    monkeypatch.chdir(tmp_path)
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    assert build_field_review(db).preview(request)['tracks'][0]['fields'][0]['before'] == 1


@pytest.mark.skipif(os.name == 'nt', reason='generated POSIX symlink control')
def test_playlist_and_field_plans_resolve_the_same_configured_db_alias(db, duplicates, tmp_path):
    from backend.models import Playlist, PlaylistTrack

    state, track, _paths, _ids = duplicates
    alias = tmp_path / 'alias-Database2'
    alias.symlink_to(state.engine.database_path, target_is_directory=True)
    state.config.database.engine_dj_path = str(alias)
    playlist = Playlist(name='Alias root')
    db.add(playlist)
    db.flush()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    plan = build_playlist_export_inspector(db).preview(playlist.name, 'engine', 'full')
    assert next(f for f in plan['tracks'][0]['fields'] if f['field'] == 'key')['before'] == 1
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='export', fields=['key'])
    assert build_field_review(db).preview(request)['tracks'][0]['fields'][0]['before'] == 1


@pytest.mark.parametrize(('root', 'stored', 'expected'), [
    ('/library', '../first/./same.flac', '/first/same.flac'),
    ('/library', '/elsewhere/same.flac', '/elsewhere/same.flac'),
    ('/library', r'..\first\same.flac', '/first/same.flac'),
    (r'C:\Library', r'..\Music\same.flac', r'C:\Music\same.flac'),
    (r'C:\Library', r'D:\Music\same.flac', r'D:\Music\same.flac'),
    (r'C:\Library', r'D:same.flac', None),
    (r'\\server\share\Library', r'..\Music\same.flac', r'\\server\share\Music\same.flac'),
    ('/library', None, None), ('/library', '', None),
])
def test_engine_path_identity_is_lexical_and_drive_aware(root, stored, expected):
    from enginedj.paths import absolute_track_path
    assert absolute_track_path(stored, root) == expected

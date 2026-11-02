"""Combined production adapters; external schemas/audio/native files are decoys."""
# ruff: noqa: F811
from pathlib import Path

import pytest

from backend.field_review import FieldReviewRequest, StaleFieldPlan
from backend.field_review_adapters import build_field_review
from backend.playlist_export_inspector import build_playlist_export_inspector
from tests.test_playlist_export_integration import destinations, playlist_members  # noqa: F401
from tests.test_rekordbox_anlz_cues import native_export, cue_times, blocks  # noqa: F401
from tests.test_rekordbox_point_over_loop import existing_loop  # noqa: F401


@pytest.fixture
def production_adapters(destinations, monkeypatch):
    """Only redirect library discovery and process/backup seams to test fixtures."""
    import backend.export_gate
    import rekordbox.connection
    from types import SimpleNamespace
    from pyrekordbox import Rekordbox6Database

    monkeypatch.setattr(backend.export_gate, 'get_config', lambda: SimpleNamespace(export=SimpleNamespace(enabled=True)))
    # Readers/writers open the real disposable pyrekordbox database, not a fake.
    monkeypatch.setattr(rekordbox.connection, 'get_rekordbox_db', lambda *args: Rekordbox6Database(
        Path(destinations.config.database.rekordbox_path) / 'master.db', unlock=False))
    yield destinations


def context(track, fields, surface='rekordbox'):
    return FieldReviewRequest(track_ids=[track.id], scope='selected', surface=surface,
                              direction='export', fields=fields)


@pytest.mark.parametrize('target', ['engine', 'rekordbox'])
def test_missing_library_record_stays_blocked_until_playlist_creation_and_replan(
    db, production_adapters, playlist_members, target
):
    from backend.field_review import FieldPlanUnavailable
    from backend.playlists.sync_manager import PlaylistSyncManager

    playlist, tracks = playlist_members(['new.flac'])
    track = tracks[0]
    track.key = 7
    db.commit()
    fields = build_field_review(db)
    request = context(track, ['key'], target)
    old = fields.preview(request)
    assert not old['executable']
    with pytest.raises(FieldPlanUnavailable):
        fields.execute(request, old['token'], [])
    inspector = build_playlist_export_inspector(db)
    plan = inspector.preview(playlist.name, target, 'order')
    assert plan['executable'], plan
    assert plan['tracks'][0]['record_action'] == 'create'
    assert plan['membership']['after'] == [track.filename]
    receipt = inspector.execute(playlist.name, target, 'order', plan['token'])
    assert receipt['results'][0]['tracks_added'] == [Path(track.filename).name]
    assert receipt['results'][0]['status'] == 'exported'
    with pytest.raises(StaleFieldPlan):
        fields.execute(request, old['token'], [])
    fresh = fields.preview(request)
    assert fresh['executable']
    replacements = [(track.id, f['field']) for f in fresh['tracks'][0]['fields'] if f['action'] == 'consent']
    result = fields.execute(request, fresh['token'], replacements)
    assert result['tracks'][0]['fields'][0]['status'] == 'applied', result
    repeat = inspector.preview(playlist.name, target, 'order')
    assert repeat['tracks'][0]['record_action'] == 'existing'
    assert inspector.execute(playlist.name, target, 'order', repeat['token'])['results'][0]['tracks_added'] == []
    manager = PlaylistSyncManager(db, production_adapters.engine, production_adapters.rb)
    assert len(manager.load_all_playlists()[target][0].tracks) == 1


@pytest.mark.parametrize('order', [['maincue', 'hotcues'], ['hotcues', 'maincue']])
def test_real_field_adapter_combines_authorized_main_hot_and_native_files(
    db, production_adapters, native_export, order
):
    from backend.models import HotCue
    from pyrekordbox.db6.tables import DjmdCue

    _writer, track, _content, dat, ext, rb = native_export
    track.cue_point_time = 0.2
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=0.1, label='Point'))
    db.commit()
    before = {p: [b for b in blocks(p.read_bytes()) if b[:4] not in (b'PCOB', b'PCO2')] for p in (dat, ext)}
    fields = build_field_review(db)
    request = context(track, order)
    plan = fields.preview(request)
    result = fields.execute(request, plan['token'], [(track.id, f) for f in order])
    assert [f['status'] for f in result['tracks'][0]['fields']] == ['applied', 'applied'], result
    rb.session.expire_all()
    assert rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).count() == 3
    assert len(cue_times(ext, 'PCO2')) == 3
    for p in (dat, ext):
        assert before[p] == [b for b in blocks(p.read_bytes()) if b[:4] not in (b'PCOB', b'PCO2')]


def test_real_field_native_failure_keeps_commit_evidence_not_success(
    db, production_adapters, native_export
):
    from backend.models import HotCue
    from pyrekordbox.db6.tables import DjmdCue

    _writer, track, _content, dat, ext, rb = native_export
    ext.unlink()  # generated decoy only
    before = dat.read_bytes()
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=0.1))
    db.commit()
    fields = build_field_review(db)
    request = context(track, ['hotcues'])
    plan = fields.preview(request)
    result = fields.execute(request, plan['token'], [(track.id, 'hotcues')])
    outcome = result['tracks'][0]['fields'][0]
    assert outcome['status'] == 'unknown'
    assert 'Cue DB committed; native DAT/EXT not synchronized' in outcome['reason']
    assert result['status'] == 'unknown'
    assert rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).count() == 2
    assert dat.read_bytes() == before


@pytest.mark.parametrize('target', ['engine', 'rekordbox'])
def test_real_playlist_partial_receipt_retains_added_record_and_unavailable_audio(
    db, production_adapters, playlist_members, target
):
    playlist, tracks = playlist_members(['new.flac', 'unavailable.flac'], missing=[1])
    inspector = build_playlist_export_inspector(db)
    plan = inspector.preview(playlist.name, target, 'order')
    assert plan['executable']
    assert [t['record_action'] for t in plan['tracks']] == ['create', 'blocked']
    assert plan['membership']['after'] == [tracks[0].filename]
    result = inspector.execute(playlist.name, target, 'order', plan['token'])['results'][0]
    assert result['status'] == 'partial'
    assert result['tracks_added'] == ['new.flac']
    assert [t['status'] for t in result['tracks']] == ['exported', 'failed']
    assert result['tracks'][1]['reason']
    assert result['tracks_exported'] == result['tracks_failed'] == 1


@pytest.mark.parametrize('seconds', [0.3, 3.0])
def test_loop_to_point_is_valid_through_combined_field_adapter(
    db, production_adapters, existing_loop, seconds
):
    from backend.models import HotCue
    from pyrekordbox.db6.tables import DjmdCue

    _writer, track, _content, dat, ext, rb = existing_loop
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=seconds, label='Point'))
    db.commit()
    service = build_field_review(db)
    request = context(track, ['hotcues'])
    plan = service.preview(request)
    receipt = service.execute(request, plan['token'], [(track.id, 'hotcues')])
    assert receipt['tracks'][0]['fields'][0]['status'] == 'applied', receipt
    rb.session.expire_all()
    assert all(row.OutMsec == -1 and row.ActiveLoop == 0 for row in rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0))
    assert len(cue_times(ext, 'PCO2')) == 2


@pytest.mark.parametrize('change', ['source', 'native', 'path'])
def test_real_observation_changes_reject_before_adapter_writes(
    db, production_adapters, native_export, change
):
    from backend.models import HotCue
    from pyrekordbox.db6.tables import DjmdCue

    _writer, track, _content, dat, ext, rb = native_export
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=0.1))
    db.commit()
    service = build_field_review(db)
    request = context(track, ['hotcues'])
    plan = service.preview(request)
    before = (dat.read_bytes(), ext.read_bytes())
    if change == 'source':
        track.title = 'Changed source'
        db.commit()
    elif change == 'native':
        ext.touch()
    else:
        production_adapters.config.database.rekordbox_path = str(dat.parent)
    with pytest.raises((StaleFieldPlan, ValueError)):
        service.execute(request, plan['token'], [(track.id, 'hotcues')])
    assert (dat.read_bytes(), ext.read_bytes()) == before
    assert not rb.session.query(DjmdCue).count()


def test_playlist_plan_is_read_only_and_native_second_replace_receipt_stays_unknown(
    db, production_adapters, native_export, monkeypatch
):
    import rekordbox.anlz_cues as native
    from backend.models import HotCue

    _writer, track, _content, dat, ext, rb = native_export
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=0.1))
    db.commit()
    service = build_field_review(db)
    request = context(track, ['hotcues'])
    production_adapters.events.clear()
    plan = service.preview(request)
    assert production_adapters.events == []  # No backup/closed/writer checks during observation.
    before = (dat.read_bytes(), ext.read_bytes())
    replace = native.os.replace

    def fail_second(source, destination):
        if Path(destination) == ext:
            raise OSError('decoy second-file failure')
        return replace(source, destination)

    monkeypatch.setattr(native.os, 'replace', fail_second)
    receipt = service.execute(request, plan['token'], [(track.id, 'hotcues')])
    outcome = receipt['tracks'][0]['fields'][0]
    assert outcome['status'] == 'unknown'
    assert 'already updated: ANLZ0000.DAT' in outcome['reason']
    assert dat.read_bytes() != before[0] and ext.read_bytes() == before[1]


def test_creation_backup_uses_validated_path_not_later_config_lookup(db, production_adapters, playlist_members):
    from backend.playlists.sync_manager import PlaylistSyncManager

    playlist, _tracks = playlist_members(['pinned.flac'])
    state = production_adapters
    pinned = state.config.database.rekordbox_path
    manager = PlaylistSyncManager(db, rb_db=state.rb, destination_paths={'rekordbox': pinned})
    state.config.database.rekordbox_path = '/not-the-reviewed-destination'
    receipt = manager.sync_playlist_to_target(playlist.name, 'manadj', 'rekordbox')
    assert receipt.success and receipt.tracks_added == ['pinned.flac']
    assert ('rekordbox:snapshot', Path(pinned)) in state.events
    assert not any(isinstance(event, tuple) and event[1] == Path('/not-the-reviewed-destination') for event in state.events)

"""Exact-ID field review tests; all destinations and writes are synthetic."""
from dataclasses import replace

import pytest

from backend.models import Track
from backend.sync_status.models import SurfaceTrackRef, TrackFields


def fixture_review(db):
    from backend.field_review import FieldReview, FieldSnapshot

    tracks = [Track(filename=f'/fixture/{i}.flac', title=f'Track {i}', key=i) for i in range(3)]
    db.add_all(tracks)
    db.commit()
    snapshot = FieldSnapshot('/fixture/engine', 'v1', [
        SurfaceTrackRef(t.filename, TrackFields(key=8, maincue=12.0)) for t in tracks
    ], {'key', 'maincue'}, {'key', 'maincue'})
    writes = []
    service = FieldReview(db, lambda surface, direction: snapshot,
                          lambda *args: writes.append(args) or {'status': 'applied'})
    return service, tracks, snapshot, writes


def request(ids, **kwargs):
    from backend.field_review import FieldReviewRequest
    return FieldReviewRequest(track_ids=ids, scope='selected', surface='engine', direction='import', fields=['key'], **kwargs)


def test_plan_is_readonly_and_execute_requires_each_saved_field_consent(db):
    service, tracks, _, writes = fixture_review(db)
    context = request([tracks[0].id, tracks[1].id])
    plan = service.preview(context)
    assert writes == []
    assert plan['track_ids'] == [tracks[0].id, tracks[1].id]
    assert 'membership' not in plan
    assert [t['fields'][0]['action'] for t in plan['tracks']] == ['consent', 'consent']
    receipt = service.execute(context, plan['token'], [(tracks[0].id, 'key')])
    assert [r['fields'][0]['status'] for r in receipt['tracks']] == ['applied', 'skipped']
    assert len(writes) == 1
    assert writes[0][0:4] == ('/fixture/engine', 'engine', 'import', tracks[0].id)
    assert writes[0][4:] == ('key', 8)


def test_blank_source_never_clears_and_blank_destination_fills(db):
    service, tracks, _, writes = fixture_review(db)
    tracks[0].key = None
    db.commit()
    context = request([tracks[0].id])
    plan = service.preview(context)
    assert plan['tracks'][0]['fields'][0]['action'] == 'fill'
    assert service.execute(context, plan['token'], [])['tracks'][0]['fields'][0]['status'] == 'applied'
    context = context.model_copy(update={'direction': 'export'})
    plan = service.preview(context)
    assert plan['tracks'][0]['fields'][0]['action'] == 'skip'
    service.execute(context, plan['token'], [])
    assert len(writes) == 1


@pytest.mark.parametrize('change', ['source', 'revision', 'identity', 'scope', 'fields', 'ids'])
def test_freshness_binds_source_target_and_exact_context(db, change):
    from backend.field_review import FieldReview, StaleFieldPlan

    service, tracks, snapshot, writes = fixture_review(db)
    context = request([tracks[0].id])
    plan = service.preview(context)
    if change == 'source':
        tracks[0].key = 22
        db.commit()
    elif change in ('revision', 'identity'):
        changed = replace(snapshot, **{change: 'changed'})
        service = FieldReview(db, lambda *args: changed, service.write)
    elif change == 'scope':
        context = context.model_copy(update={'scope': 'all'})
    elif change == 'fields':
        context = context.model_copy(update={'fields': ['maincue']})
    else:
        context = context.model_copy(update={'track_ids': [tracks[1].id]})
    with pytest.raises(StaleFieldPlan):
        service.execute(context, plan['token'], [(tracks[0].id, 'key')])
    assert writes == []


def test_missing_records_and_unsupported_fields_block_without_creating(db):
    service, tracks, snapshot, writes = fixture_review(db)
    context = request([tracks[0].id])
    service.read = lambda *args: replace(snapshot, tracks=[])
    plan = service.preview(context)
    assert not plan['executable']
    assert plan['tracks'][0]['fields'][0]['action'] == 'blocked'
    from backend.field_review import FieldPlanUnavailable
    with pytest.raises(FieldPlanUnavailable):
        service.execute(context, plan['token'], [])
    service.read = lambda *args: snapshot
    context = context.model_copy(update={'fields': ['tags']})
    plan = service.preview(context)
    assert not plan['executable']
    assert 'not supported' in plan['tracks'][0]['fields'][0]['reason']
    assert writes == []


def test_duplicate_pending_execution_and_out_of_scope_consent_are_rejected(db):
    from backend.field_review import FieldPlanUnavailable, FieldReviewBusy
    service, tracks, _, writes = fixture_review(db)
    context = request([tracks[0].id])
    plan = service.preview(context)
    with pytest.raises(FieldPlanUnavailable):
        service.execute(context, plan['token'], [(tracks[1].id, 'key')])

    def write(*args):
        with pytest.raises(FieldReviewBusy):
            service.execute(context, plan['token'], [(tracks[0].id, 'key')])
        writes.append(args)
        return {'status': 'applied'}

    service.write = write
    service.execute(context, plan['token'], [(tracks[0].id, 'key')])
    assert len(writes) == 1


def test_scope_contract_rejects_implicit_all_duplicates_and_missing_ids(db):
    from pydantic import ValidationError
    from backend.field_review import FieldPlanUnavailable
    service, tracks, _, _ = fixture_review(db)
    for ids in ([], [tracks[0].id, tracks[0].id]):
        with pytest.raises(ValidationError):
            request(ids)
    with pytest.raises(FieldPlanUnavailable):
        service.preview(request([999999]))


def test_receipts_keep_field_failures_and_exceptions_unknown(db):
    service, tracks, _, _ = fixture_review(db)
    context = request([tracks[0].id, tracks[1].id, tracks[2].id])
    plan = service.preview(context)

    def write(_path, _surface, _direction, track_id, _field, _value):
        if track_id == tracks[0].id:
            return {'status': 'failed', 'reason': 'Writer refused before writing'}
        if track_id == tracks[1].id:
            raise OSError('Lost acknowledgement after dispatch')
        return {'status': 'applied'}

    service.write = write
    receipt = service.execute(context, plan['token'], [(t.id, 'key') for t in tracks])
    assert receipt['status'] == 'unknown'
    assert [row['fields'][0]['status'] for row in receipt['tracks']] == ['failed', 'unknown', 'applied']
    assert receipt['track_ids'] == [t.id for t in tracks]


@pytest.mark.parametrize('scope', ['selected', 'filtered', 'all'])
def test_every_scope_label_executes_only_frozen_ids(db, scope):
    service, tracks, _, writes = fixture_review(db)
    context = request([tracks[1].id]).model_copy(update={'scope': scope})
    plan = service.preview(context)
    service.execute(context, plan['token'], [(tracks[1].id, 'key')])
    assert [call[3] for call in writes] == [tracks[1].id]


def test_real_router_and_library_import_persist_only_reviewed_fields(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.field_review_adapters import import_field
    from backend.routers.sync_fields import get_field_review, router
    service, tracks, _, _ = fixture_review(db)
    service.write = lambda path, surface, direction, track_id, field, value: import_field(db, track_id, field, value)
    app = FastAPI()
    app.include_router(router, prefix='/api')
    app.dependency_overrides[get_field_review] = lambda: service
    client = TestClient(app)
    context = request([tracks[0].id]).model_dump()
    plan = client.post('/api/sync/fields/plan', json=context).json()
    response = client.post('/api/sync/fields/execute', json={**context, 'token': plan['token'],
                           'replacements': [{'track_id': tracks[0].id, 'field': 'key'}]})
    assert response.status_code == 200
    assert response.json()['tracks'][0]['fields'][0]['status'] == 'applied'
    db.expire_all()
    assert db.get(Track, tracks[0].id).key == 8
    assert db.get(Track, tracks[0].id).key_provenance == 'imported'
    assert db.get(Track, tracks[1].id).key == 1
    assert db.get(Track, tracks[0].id).title == 'Track 0'


def test_export_router_gate_precedes_dispatch_and_import_remains_available(db, monkeypatch):
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from backend.routers.sync_fields import get_field_review, router
    service, tracks, _, writes = fixture_review(db)
    app = FastAPI()
    app.include_router(router, prefix='/api')
    app.dependency_overrides[get_field_review] = lambda: service
    def disabled():
        raise HTTPException(403, 'Export disabled')
    monkeypatch.setattr('backend.routers.sync_fields.require_export_enabled', disabled)
    client = TestClient(app)
    context = request([tracks[0].id]).model_dump()
    context['direction'] = 'export'
    plan = client.post('/api/sync/fields/plan', json=context).json()
    response = client.post('/api/sync/fields/execute', json={**context, 'token': plan['token'], 'replacements': []})
    assert response.status_code == 403
    assert writes == []


@pytest.mark.parametrize('field', ['key', 'energy', 'maincue', 'hotcues', 'beatgrid'])
def test_engine_selected_field_writer_preserves_other_fields(tmp_path, field):
    import struct
    from enginedj.models.track import Track as EngineTrack
    from enginedj.models.performance_data import PerformanceData
    from enginedj.perf_export import EnginePerfExporter
    from enginedj.performance_blobs import parse_quick_cues, q_compress
    from backend.sync_status.models import TempoChangeValue
    from tests.test_engine_track_export import InMemoryEngineDB
    from tests.test_engine_performance_blobs import build_beat_blob, build_quick_cues_blob, CONSTANT_GRID, EMPTY_SLOT
    root = tmp_path / 'engine'
    (root / 'Database2').mkdir(parents=True)
    connection = InMemoryEngineDB(root)
    with connection.session_m_write() as session:
        track = EngineTrack(path='../Tracks/a.flac', filename='a.flac', title='Original', key=1, rating=20, isAnalyzed=False)
        session.add(track)
        session.flush()
        session.add(PerformanceData(trackId=track.id,
            beatData=build_beat_blob(default_grid=CONSTANT_GRID, adjusted_grid=CONSTANT_GRID),
            quickCues=build_quick_cues_blob([EMPTY_SLOT] * 8),
            trackData=q_compress(struct.pack('>dQI3d', 44100.0, 44100 * 180, 1, 0, 0, 0))))
    with connection.session_m() as session:
        before_perf = session.query(PerformanceData).one()
        before = {name: getattr(before_perf, name) for name in ('beatData', 'quickCues', 'trackData')}
        old_cues = parse_quick_cues(before_perf.quickCues)
    result = EnginePerfExporter(connection, root / 'Database2').export_performance('/fixture/a.flac',
        cues=[(1, 12.0, 'New', '#FF0000')], tempo_changes=[TempoChangeValue(0.4, 128)],
        key=8, maincue=30.0, energy=5, duration=180, selected_fields={field})
    assert set(result) == {field}
    with connection.session_m() as session:
        saved = session.query(EngineTrack).one()
        perf = session.query(PerformanceData).one()
        assert saved.title == 'Original'
        assert saved.isAnalyzed is False
        if field != 'key':
            assert saved.key == 1 and perf.trackData == before['trackData']
        if field != 'energy':
            assert saved.rating == 20
        if field != 'beatgrid':
            assert perf.beatData == before['beatData']
        if field not in ('hotcues', 'maincue'):
            assert perf.quickCues == before['quickCues']
        else:
            cues = parse_quick_cues(perf.quickCues)
            if field == 'hotcues':
                assert cues.main_cue_samples == old_cues.main_cue_samples
                assert cues.main_cue_overridden == old_cues.main_cue_overridden
            else:
                assert cues.hot_cues == old_cues.hot_cues


def test_rekordbox_adapter_uses_validated_path_and_only_chosen_method(db, monkeypatch):
    from contextlib import contextmanager
    from pathlib import Path
    from backend.field_review_adapters import export_field
    track = Track(filename='/fixture/a.flac', title='A', key=1)
    db.add(track)
    db.commit()
    calls = []
    @contextmanager
    def connection(surface, path):
        calls.append((surface, path))
        yield 'fixture'
    class Writer:
        def __init__(self, connection, path):
            assert connection == 'fixture'
            assert path == Path('/fixture/validated')
        def export_key(self, filename, value):
            calls.append((filename, value))
            return '8m'
    monkeypatch.setattr('backend.export_gate.require_export_enabled', lambda: None)
    monkeypatch.setattr('backend.field_review_adapters.external_connection', connection)
    monkeypatch.setattr('rekordbox.perf_export.RekordboxPerfExporter', Writer)
    result = export_field(db, '/fixture/validated', 'rekordbox', track.id, 'key', 8)
    assert result['status'] == 'applied'
    assert calls == [('rekordbox', Path('/fixture/validated')), ('/fixture/a.flac', 8)]


def test_export_adapter_gate_precedes_destination_connection(db, monkeypatch):
    from fastapi import HTTPException
    from backend.field_review_adapters import export_field
    def disabled():
        raise HTTPException(403, 'disabled')
    def forbidden(*args):
        raise AssertionError('Disabled export must not open a destination')
    monkeypatch.setattr('backend.export_gate.require_export_enabled', disabled)
    monkeypatch.setattr('backend.field_review_adapters.external_connection', forbidden)
    with pytest.raises(HTTPException):
        export_field(db, '/fixture/never-open', 'engine', 1, 'key', 8)

"""Review regressions with generated destinations only; no installed libraries."""
from contextlib import contextmanager
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize('order', [['hotcues', 'maincue'], ['maincue', 'hotcues']])
def test_selected_maincue_survives_both_rekordbox_field_orders(db, monkeypatch, tmp_path, order):
    from sqlalchemy import Column, MetaData, Table, create_engine
    from sqlalchemy.orm import Session
    from pyrekordbox.db6.tables import DjmdCue
    from backend.models import HotCue, Track
    from backend.field_review import FieldReview, FieldReviewRequest, FieldSnapshot
    from backend.field_review_adapters import capabilities, export_field
    from backend.sync_status.models import SurfaceTrackRef, TrackFields
    from rekordbox.perf_export import RekordboxPerfExporter

    # Ordering probe only: native defaults/bookkeeping are intentionally absent.
    engine = create_engine('sqlite:///:memory:')
    table = Table('djmdCue', MetaData(), *(Column(column.name, column.type,
        primary_key=column.primary_key, nullable=True) for column in DjmdCue.__table__.columns))
    table.create(engine)
    with Session(engine) as destination_session:
        class Destination:
            counter = 0

            session = destination_session

            def generate_unused_id(self, _model):
                self.counter += 1
                return str(self.counter)

            def commit(self, autoinc=False):
                self.session.commit()

        destination = Destination()

        @contextmanager
        def connection(surface, path):
            yield destination

        monkeypatch.setattr('backend.field_review_adapters.external_connection', connection)
        monkeypatch.setattr('backend.export_gate.require_export_enabled', lambda: None)
        monkeypatch.setattr('rekordbox.perf_export.ensure_rekordbox_closed', lambda: None)
        monkeypatch.setattr('rekordbox.perf_export.snapshot_library', lambda path: None)
        monkeypatch.setattr('rekordbox.decode_offset.manadj_seconds_to_rb_ms', lambda seconds, path: int(seconds * 1000))
        monkeypatch.setattr(RekordboxPerfExporter, '_content_for', lambda self, filename: SimpleNamespace(
            ID='7', UUID='generated-content', FolderPath=filename))
        # This original ordering regression isolates cue DB sequencing. The
        # combined real native adapter is covered by test_library_export_integration.
        monkeypatch.setattr(RekordboxPerfExporter, '_sync_cue_analysis', lambda *args: None)
        track = Track(filename='/fixture/a.flac', title='A', cue_point_time=30.0)
        db.add(track)
        db.flush()
        db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=10.0))
        db.commit()
        snapshot = FieldSnapshot(str(tmp_path), 'v1', [SurfaceTrackRef(track.filename, TrackFields(hotcues=[]))],
                                 {'hotcues'}, capabilities('rekordbox', 'export'))
        calls = []

        def write(path, surface, direction, ident, field, value):
            calls.append(field)
            return export_field(db, path, surface, ident, field, value)

        service = FieldReview(db, lambda *args: snapshot, write)
        request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='rekordbox', direction='export', fields=order)
        plan = service.preview(request)
        receipt = service.execute(request, plan['token'], [(track.id, field) for field in order])
        assert all(field['status'] == 'applied' for field in receipt['tracks'][0]['fields'])
        memory = destination_session.query(DjmdCue).filter(DjmdCue.Kind == 0, DjmdCue.rb_local_deleted == 0).all()
        assert 30000 in [cue.InMsec for cue in memory]
        assert calls == ['hotcues', 'maincue']
        assert [field['field'] for field in receipt['tracks'][0]['fields']] == order
    engine.dispose()


@pytest.mark.parametrize('attribute,value', [('anchor_time', 25.0), ('origin', 'imported')])
def test_grid_destination_revision_rejects_newer_edits_then_fresh_review_can_clear(db, attribute, value):
    from backend.models import Beatgrid, Track
    from backend.field_review import FieldReview, FieldReviewRequest, FieldSnapshot, StaleFieldPlan
    from backend.field_review_adapters import import_field
    from backend.sync_status.models import BeatgridValue, SurfaceTrackRef, TempoChangeValue, TrackFields
    from tests.test_sync_performance_grid_maincue import add_grid

    track = Track(filename='/fixture/anchor.flac', title='Anchor', bpm=12800, duration_secs=180)
    db.add(track)
    db.commit()
    add_grid(db, track.id, 'edited', (0.5, 128.0))
    snapshot = FieldSnapshot('/fixture/engine', 'v1', [SurfaceTrackRef(track.filename,
        TrackFields(beatgrid=BeatgridValue([TempoChangeValue(0.7, 130)])))], {'beatgrid'}, {'beatgrid'})
    writes = []

    def write(path, surface, direction, ident, field, after):
        writes.append(field)
        return import_field(db, ident, field, after)

    service = FieldReview(db, lambda *args: snapshot, write)
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='engine', direction='import', fields=['beatgrid'])
    plan = service.preview(request)
    grid = db.query(Beatgrid).filter_by(track_id=track.id).one()
    setattr(grid, attribute, value)
    db.commit()
    with pytest.raises(StaleFieldPlan):
        service.execute(request, plan['token'], [(track.id, 'beatgrid')])
    assert writes == []
    assert getattr(db.get(Beatgrid, grid.id), attribute) == value
    fresh = service.preview(request)
    service.execute(request, fresh['token'], [(track.id, 'beatgrid')])
    assert writes == ['beatgrid']
    db.refresh(grid)
    assert grid.anchor_time is None and grid.origin == 'imported'


@pytest.mark.parametrize('fields', [['hotcues'], ['maincue', 'hotcues']])
def test_reordering_does_not_restore_unselected_or_unconsented_maincue(db, fields):
    from backend.field_review import FieldReview, FieldReviewRequest, FieldSnapshot
    from backend.models import HotCue, Track
    from backend.sync_status.models import SurfaceTrackRef, TrackFields
    track = Track(filename='/fixture/a.flac', cue_point_time=30.0)
    db.add(track)
    db.flush()
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=10.0))
    db.commit()
    snapshot = FieldSnapshot('/fixture/rb', 'v1', [SurfaceTrackRef(track.filename, TrackFields(hotcues=[]))], {'hotcues'}, {'hotcues', 'maincue'})
    writes = []
    service = FieldReview(db, lambda *args: snapshot, lambda *args: writes.append(args[4]) or {'status': 'applied'})
    request = FieldReviewRequest(track_ids=[track.id], scope='selected', surface='rekordbox', direction='export', fields=fields)
    plan = service.preview(request)
    service.execute(request, plan['token'], [(track.id, 'hotcues')])
    assert writes == ['hotcues']

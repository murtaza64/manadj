"""Production field seams; preview opens readers only, execution pins their path."""
from contextlib import contextmanager
import json
from pathlib import Path

from backend import models
from backend.field_review import FieldPlanUnavailable, FieldReview, FieldSnapshot
from backend.sync_status.models import BeatgridValue, HotCueValue, TempoChangeValue


def capabilities(surface, direction):
    if direction == 'import':
        fields = {'title', 'artist', 'energy', 'key', 'hotcues', 'beatgrid'}
        return fields | {'maincue'} if surface == 'engine' else fields
    # Tags/energy RB writer combines catalogue/color writes and cannot yet be
    # isolated. Never offer a field selector that widens into that operation.
    return {'key', 'hotcues', 'beatgrid', 'maincue'} if surface == 'rekordbox' else {'key', 'energy', 'hotcues', 'beatgrid', 'maincue'}


@contextmanager
def external_connection(surface, path):
    if surface == 'rekordbox':
        from rekordbox.connection import get_rekordbox_db
        connection = get_rekordbox_db(path)
        try:
            yield connection
        finally:
            connection.close()
    else:
        from enginedj.connection import EngineDJDatabase
        connection = EngineDJDatabase(path)
        try:
            yield connection
        finally:
            connection.m_engine.dispose()
            connection.m_engine_write.dispose()
            if connection.hm_engine is not None:
                connection.hm_engine.dispose()


def read_snapshot(surface, direction):
    from backend.config import get_config
    from backend.sync_status.adapters import EngineSurfaceReader, RekordboxSurfaceReader
    config = get_config().database
    raw = config.engine_dj_path if surface == 'engine' else config.rekordbox_path
    if not raw or not Path(raw).is_dir():
        raise FieldPlanUnavailable(f'{surface} library is not configured or available')
    path = Path(raw).resolve()
    try:
        with external_connection(surface, path) as connection:
            reader = EngineSurfaceReader(connection) if surface == 'engine' else RekordboxSurfaceReader(connection)
            tracks = reader.list_tracks()
            revisions = []
            for file in sorted(path.rglob('*')):
                if file.is_file() and (file.name.lower().endswith(('.db', '.db-wal')) or file.suffix.upper() in {'.DAT', '.EXT', '.2EX'}):
                    stat = file.stat()
                    if file.name.lower().endswith('.db-wal') and not stat.st_size:
                        continue
                    revisions.append((str(file.relative_to(path)), stat.st_size, stat.st_mtime_ns))
            return FieldSnapshot(str(path), json.dumps(revisions), tracks, set(reader.fields), capabilities(surface, direction))
    except Exception as error:
        raise FieldPlanUnavailable(f'Could not observe {surface}: {error}') from error


def import_field(db, track_id, field, value):
    from backend.sync_performance.apply import import_beatgrid, import_hotcues, import_maincue
    if field == 'hotcues':
        result = import_hotcues(db, track_id, [HotCueValue(**cue) for cue in value], 'replace-all')
    elif field == 'beatgrid':
        result = import_beatgrid(db, track_id, BeatgridValue([TempoChangeValue(**tc) for tc in value['tempo_changes']]), 'replace')
    elif field == 'maincue':
        result = import_maincue(db, track_id, value, 'replace')
    elif field in {'title', 'artist', 'key', 'energy'}:
        track = db.get(models.Track, track_id)
        if track is None:
            raise FieldPlanUnavailable('Captured Library track no longer exists')
        setattr(track, field, value)
        if field == 'key':
            track.key_provenance = 'imported'
        db.commit()
        result = {'imported': True}
    else:
        raise FieldPlanUnavailable(f'Unsupported import field {field}')
    return {'status': 'applied' if result.get('imported', 0) else 'skipped', 'detail': result}


def export_field(db, path, surface, track_id, field, value):
    from backend.export_gate import require_export_enabled
    require_export_enabled()  # Also guard direct service calls, before writer creation.
    track = db.get(models.Track, track_id)
    if track is None:
        raise FieldPlanUnavailable('Captured Library track no longer exists')
    with external_connection(surface, Path(path)) as connection:
        if surface == 'rekordbox':
            from rekordbox.perf_export import RekordboxPerfExporter
            writer = RekordboxPerfExporter(connection, Path(path))
            if field == 'key':
                result = writer.export_key(track.filename, value)
            elif field == 'hotcues':
                result = writer.export_hotcues(track.filename, [(c['slot'], c['time'], c['label'], c['color']) for c in value], 'replace-all')
            elif field == 'maincue':
                result = writer.export_maincue(track.filename, value)
            elif field == 'beatgrid':
                result = writer.export_beatgrid(track.filename, [TempoChangeValue(**tc) for tc in value['tempo_changes']], track.duration_secs or getattr(track.waveform, 'duration', None))
            else:
                raise FieldPlanUnavailable(f'Unsupported Rekordbox export field {field}')
            return {'status': 'applied', 'detail': result}
        from enginedj.perf_export import EnginePerfExporter
        result = EnginePerfExporter(connection, Path(path)).export_performance(
            track.filename, cues=[(c['slot'], c['time'], c['label'], c['color']) for c in value] if field == 'hotcues' else [],
            tempo_changes=[TempoChangeValue(**tc) for tc in value['tempo_changes']] if field == 'beatgrid' else None,
            key=value if field == 'key' else None, maincue=value if field == 'maincue' else None,
            energy=value if field == 'energy' else None,
            duration=track.duration_secs or getattr(track.waveform, 'duration', None), selected_fields={field})
        outcome = result.get(field, 'unknown: no field outcome')
        status = 'applied' if outcome.startswith('exported') else 'skipped' if outcome.startswith('skipped') else 'unknown'
        return {'status': status, 'reason': outcome}


def build_field_review(db):
    def write(path, surface, direction, track_id, field, value):
        if field not in capabilities(surface, direction):
            raise FieldPlanUnavailable('Field not supported by this writer')
        return import_field(db, track_id, field, value) if direction == 'import' else export_field(db, path, surface, track_id, field, value)
    return FieldReview(db, read_snapshot, write)

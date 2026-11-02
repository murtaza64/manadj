"""#430 real field API/Library persistence, synthetic external observations/writes.

No production app startup, config discovery, installed databases or media.
"""
import argparse
from dataclasses import asdict, replace
import os
from pathlib import Path
import sys

os.environ['MANADJ_DB_URL'] = 'sqlite:///:memory:'
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
import uvicorn  # noqa: E402
from scripts.agent import review_export_inspector as seed  # noqa: E402
from backend.field_review import FieldReview, FieldSnapshot  # noqa: E402
from backend.field_review_adapters import capabilities, import_field  # noqa: E402
from backend.routers import sync_fields  # noqa: E402
from backend.sync_status.models import SurfaceTrackRef  # noqa: E402

app = FastAPI(title='Synthetic external adapters; real #430 contracts')
state = {'scenario': 'normal', 'writes': []}


def service():
    with Session(seed.engine) as db:
        def read(surface, direction):
            entries = list(seed.state['fields'].items())
            if state['scenario'] == 'blocked':
                entries = entries[:-1]
            return FieldSnapshot(f'/fixture/{surface}', str(seed.state['revision']),
                [SurfaceTrackRef(path, replace(fields, maincue=32.0, title='External title')) for path, fields in entries],
                {'title', 'artist', 'energy', 'key', 'hotcues', 'beatgrid'} | ({'maincue'} if surface == 'engine' else set()),
                capabilities(surface, direction))

        def write(path, surface, direction, track_id, field, value):
            state['writes'].append({'id': track_id, 'field': field, 'direction': direction})
            if state['scenario'] == 'partial' and field == 'hotcues':
                return {'status': 'failed', 'reason': 'Synthetic adapter rejected this field before write'}
            if direction == 'import':
                result = import_field(db, track_id, field, value)
            else:
                track = db.get(seed.models.Track, track_id)
                # Synthetic target only; real Engine/RB field writers are verified
                # separately in isolated generated destination tests.
                values = asdict(seed.state['fields'][track.filename])
                values[field] = value
                from backend.sync_status.models import TrackFields
                seed.state['fields'][track.filename] = TrackFields(**values)
                seed.state['revision'] += 1
                result = {'status': 'applied'}
            if state['scenario'] == 'unknown':
                raise OSError('Synthetic receipt lost after dispatch')
            return result
        yield FieldReview(db, read, write)


app.include_router(sync_fields.router, prefix='/api')
app.dependency_overrides[sync_fields.get_field_review] = service


def gate():
    if state['scenario'] == 'gated':
        raise HTTPException(403, 'External export disabled in fixture')


# Router refers to this function at execution; no production config is opened.
sync_fields.require_export_enabled = gate


@app.get('/fixture/identity')
def identity():
    return {'fixture': 'field-review-430', 'real_external_writes': False, 'library': 'Alembic in-memory'}


@app.get('/source.json')
def source():
    return {'issue': 430, 'pin': os.environ.get('MANADJ_REVIEW_SOURCE_PIN', 'working-copy'),
            'external_adapters': 'synthetic', 'library': 'Alembic in-memory', 'installed_app': False}


@app.post('/fixture/reset')
def reset(scenario: str = 'normal'):
    if scenario not in {'normal', 'partial', 'unknown', 'blocked', 'gated'}:
        raise HTTPException(400, 'Unknown scenario')
    seed.reset('skips')
    state.update(scenario=scenario, writes=[])
    return identity()


@app.post('/fixture/change')
def change():
    seed.state['revision'] += 1
    return {'revision': seed.state['revision']}


@app.get('/fixture/writes')
def writes():
    return state['writes']


@app.get('/api/config')
def config():
    return {'export_enabled': state['scenario'] != 'gated'}


@app.get('/api/tracks/')
def tracks():
    with Session(seed.engine) as db:
        items = [{'id': t.id, 'title': t.title, 'artist': t.artist, 'key': t.key, 'filename': t.filename} for t in db.query(seed.models.Track).order_by(seed.models.Track.id)]
        return {'items': items, 'total': len(items), 'library_total': len(items), 'total_pages': 1}


@app.get('/api/sync/status/')
def status():
    items = tracks()['items']
    return {'surfaces_available': ['engine', 'rekordbox'],
            'counts': {'diverged': len(items), 'in-sync': 0, 'missing-downstream': 0, 'unimported': 0, 'not-in-library': 0},
            'rows': [{'path': t['filename'], 'title': t['title'], 'artist': t['artist'], 'track_id': t['id'],
                      'presence': {'disk': True, 'library': True, 'engine': True, 'rekordbox': True},
                      'status': 'diverged', 'unprocessed': False, 'archived': False,
                      'diverged': [{'field': 'key', 'library_value': t['key'], 'surface_values': {'engine': 7}, 'importable_from': ['engine'], 'no_overwrite': False}],
                      'warnings': []} for t in items]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5434)
    parser.add_argument('--assets', type=Path, required=True)
    args = parser.parse_args()
    app.mount('/', StaticFiles(directory=args.assets, html=True))
    uvicorn.run(app, host=args.host, port=args.port)

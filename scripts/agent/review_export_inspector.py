"""Fixture-only #426 review server: real plan/execute routes + in-memory DB.

Run after building frontend/scripts/review-export426/vite.config.ts:
uv run scripts/agent/review_export_inspector.py --host 192.168.1.235 --port 5426
No app startup, real DB, config discovery, downstream writer or device access.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

os.environ['MANADJ_DB_URL'] = 'sqlite:///:memory:'
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi import APIRouter, FastAPI, HTTPException  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import PlainTextResponse  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
import uvicorn  # noqa: E402

from backend import models  # noqa: E402
from backend.export_gate import require_export_enabled  # noqa: E402
from backend.playlist_export_inspector import DestinationSnapshot, PlaylistExportInspector, PlanUnavailable  # noqa: E402
from backend.playlist_full_export import PlaylistExportTargetRunner, PlaylistFullExportService  # noqa: E402
from backend.routers import sync_export  # noqa: E402
from backend.sync_status.compare import beatgrid_value_from_row, hotcue_values_from_rows  # noqa: E402
from backend.sync_status.models import BeatgridValue, HotCueValue, SurfaceTrackRef, TempoChangeValue, TrackFields  # noqa: E402

engine = create_engine('sqlite:///:memory:', poolclass=StaticPool, connect_args={'check_same_thread': False})
with engine.connect() as connection:
    config = Config(str(ROOT / 'alembic.ini'))
    config.set_main_option('script_location', str(ROOT / 'alembic'))
    config.attributes.update(connection=connection, configure_logger=False)
    command.upgrade(config, 'head')

TITLES = ['Eyes Cut Deeper', 'Afterimage', 'Pressure Drop', 'Night Shift', 'Last Train', 'Daybreak']
state = {'scenario': 'skips', 'revision': 0, 'reads': 0, 'fields': {}, 'order': []}


def reset(name):
    with Session(engine) as db:
        for cls in (models.TrackTag, models.HotCue, models.Beatgrid, models.PlaylistTrack,
                    models.Playlist, models.Tag, models.TagCategory, models.Track):
            db.query(cls).delete()
        playlist = models.Playlist(name='Night Shift')
        category = models.TagCategory(name='Mood')
        db.add_all([playlist, category])
        db.flush()
        tag = models.Tag(name='Peak', category_id=category.id)
        db.add(tag)
        db.flush()
        for i, title in enumerate(TITLES):
            track = models.Track(id=i + 1, title=title, artist='Fixture Artist', filename=f'/fixture/{title}.flac', duration_secs=200, key=8, energy=None if i == 0 else 4)
            db.add(track)
            db.flush()
            db.add(models.PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=i))
            db.add(models.TrackTag(track_id=track.id, tag_id=tag.id))
            if i != 0:
                db.add(models.HotCue(track_id=track.id, slot_number=1, time_seconds=2.6))
                db.add(models.HotCue(track_id=track.id, slot_number=2, time_seconds=24))
            if i != 1:
                db.add(models.Beatgrid(track_id=track.id, origin='edited', tempo_changes_json=json.dumps([{'start_time': 0.36, 'bpm': 174, 'bar_position': 1}])))
        db.commit()
    paths = [f'/fixture/{t}.flac' for t in TITLES]
    state.update(scenario=name, revision=state['revision'] + 1, reads=0,
                 order=[paths[1], paths[0], '/fixture/Old entry.flac', *paths[2:-1]],
                 fields={path: TrackFields(key=7, energy=4, tags=['Old'],
                         hotcues=[HotCueValue(1, 1.1), HotCueValue(4, 14.5)],
                         beatgrid=BeatgridValue([TempoChangeValue(0.32, 173.98)])) for path in paths})


def read(name, target):
    if state['scenario'] == 'unavailable':
        raise PlanUnavailable('Fixture destination is unavailable. No connection to a real library was attempted.')
    state['reads'] += 1
    items = list(state['fields'].items())
    if state['scenario'] == 'blocked':
        items = items[:-1]
    return DestinationSnapshot(f'/fixture/{target}', list(state['order']),
                               [SurfaceTrackRef(path, fields) for path, fields in items],
                               {'hotcues', 'beatgrid', 'key', 'tags', 'energy'} | ({'maincue'} if target == 'engine' else set()),
                               str(state['revision']) + (str(state['reads']) if state['scenario'] == 'stale' else ''))


def inspector():
    with Session(engine) as db:
        def write(name, target, scope, destination):
            class Writer:
                def __init__(self):
                    self.target = target

                def prepare(self, tracks):
                    if state['scenario'] == 'slow':
                        time.sleep(5)

                def replace_playlist(self, name, tracks):
                    state['order'] = [t.filename for t in tracks]
                    state['revision'] += 1
                    return False, {}

                def export_track(self, track):
                    if scope == 'order':
                        return {}
                    old = state['fields'][track.filename]
                    failure = state['scenario'] == 'partial' and track.id == 1
                    grid = beatgrid_value_from_row(track.beatgrid)
                    state['fields'][track.filename] = TrackFields(
                        key=track.key, energy=track.energy, tags=[tt.tag.name for tt in track.track_tags],
                        hotcues=old.hotcues if failure else hotcue_values_from_rows(track.hotcues),
                        beatgrid=grid or old.beatgrid, maincue=track.cue_point_time)
                    return {'hotcues': 'failed: fixture native-file write' if failure else 'exported',
                            'beatgrid': 'exported' if grid else 'skipped: Library has no saved grid',
                            'maincue': 'exported: cleared', 'energy': ('skipped: Library has no energy' if target == 'engine' else 'exported: cleared') if track.energy is None else 'exported',
                            'key': 'exported', 'tags': 'exported'}
            report = PlaylistFullExportService(db, {target: PlaylistExportTargetRunner(Writer())}).export(name, [target])
            if state['scenario'] == 'unknown':
                raise RuntimeError('Fixture receipt lost after in-memory writes')
            return report
        yield PlaylistExportInspector(db, read, write)


reset('skips')
app = FastAPI(title='FIXTURE ONLY #426')
# Whitelist only the new guarded operations. Never expose legacy routes whose
# dependency defaults could instantiate a real destination writer.
review_router = APIRouter(routes=[r for r in sync_export.router.routes if r.path in (
    '/sync/export/playlists/plan', '/sync/export/playlists/execute')])
app.include_router(review_router, prefix='/api')
app.dependency_overrides[sync_export.get_playlist_export_inspector] = inspector


def gate():
    if state['scenario'] == 'gated':
        raise HTTPException(403, 'External export is off (fixture)')


app.dependency_overrides[require_export_enabled] = gate


@app.get('/api/config')
def fixture_config():
    return {'export_enabled': state['scenario'] != 'gated'}


@app.get('/api/tracks/{track_id}')
def fixture_track(track_id: int):
    return {'id': track_id, 'title': TITLES[track_id - 1], 'artist': 'Fixture Artist', 'filename': f'/fixture/{TITLES[track_id - 1]}.flac', 'bpm': 174, 'key': 8, 'energy': 4}


@app.get('/api/playlists/')
def fixture_playlists():
    with Session(engine) as db:
        return [{'id': p.id, 'name': p.name} for p in db.query(models.Playlist)]


@app.get('/api/sync/playlists/')
def fixture_unified_playlists():
    entries = [{'track_id': i + 1, 'filename': f'/fixture/{title}.flac'} for i, title in enumerate(TITLES)]
    return [{'name': 'Night Shift', 'manadj': entries, 'engine': entries, 'rekordbox': entries, 'synced': False}]


@app.get('/api/sync/playlists/stats')
def fixture_playlist_stats():
    return {'manadj_playlists_loaded': 1, 'engine_playlists_loaded': 1, 'rekordbox_playlists_loaded': 1, 'playlists_matched': 1}


@app.post('/fixture/scenario')
def fixture_scenario(name: str):
    if name not in {'skips', 'partial', 'blocked', 'unavailable', 'stale', 'unknown', 'slow', 'gated'}:
        raise HTTPException(400, 'Unknown fixture')
    reset(name)
    return {'fixture': name, 'real_writes': False}


@app.get('/review-notes', response_class=PlainTextResponse)
def review_notes():
    return (ROOT / 'docs/prds/sync-export-inspector.md').read_text()


@app.get('/fixture/identity')
def fixture_identity():
    return {'fixture': 'playlist-export-426', 'real_writes': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5426)
    parser.add_argument('--assets', type=Path, default=Path('/tmp/opencode/manadj-export-inspector-426-dist'))
    args = parser.parse_args()
    app.mount('/', StaticFiles(directory=str(args.assets), html=True), name='fixture-ui')
    uvicorn.run(app, host=args.host, port=args.port)

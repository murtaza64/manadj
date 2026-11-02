"""#442 full Library + production export routes/adapters on disposable fixtures.

No production startup, installed profile discovery or real library/media access.
Native-layout fixtures are generated; Rekordbox fixture is unencrypted SQLite,
not proof of installed encrypted-library/native application compatibility.
"""
import argparse
from datetime import datetime
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace

os.environ['MANADJ_DB_URL'] = 'sqlite:///:memory:'
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from sqlalchemy import MetaData, create_engine, event  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
import uvicorn  # noqa: E402


def create_review(root: Path, pin: str):
    os.environ['MANADJ_DATA_DIR'] = str(root)
    # Only a fresh owner directory from mkdtemp is accepted by the CLI.
    engine_path = root / 'Engine Library' / 'Database2'
    rb_path = root / 'Rekordbox'
    engine_path.mkdir(parents=True)
    rb_path.mkdir()
    from enginedj.base import Base as EngineBase
    from enginedj.models.information import Information
    from pyrekordbox.db6 import tables
    from pyrekordbox import Rekordbox6Database
    import pyrekordbox.db6.database as rb_api
    import rekordbox.connection
    import backend.config
    import backend.export_gate

    external = create_engine(f'sqlite:///{engine_path / "m.db"}')
    EngineBase.metadata.create_all(external)  # External fixture schema only.
    with Session(external) as db:
        db.add(Information(uuid='review442-engine', schemaVersionMajor=3, schemaVersionMinor=0, schemaVersionPatch=1))
        db.commit()
    external.dispose()
    external = create_engine(f'sqlite:///{rb_path / "master.db"}')
    schema = MetaData()
    for table in tables.Base.metadata.sorted_tables:
        copied = table.to_metadata(schema)
        for column in copied.columns:
            if not column.primary_key and column.default is None:
                column.nullable = True
    schema.create_all(external)
    with Session(external) as db:
        db.add_all([tables.AgentRegistry(registry_id='localUpdateCount', int_1=0,
                    date_1=datetime.now(), date_2=datetime.now()),
                    tables.DjmdDevice.create(ID='device', MasterDBID='review442-master', Name='Decoy'),
                    tables.DjmdMenuItems.create(ID='track', Name='TRACK', rb_local_usn=1)])
        db.commit()
    external.dispose()
    # Deliberately scoped discovery seam; never asks pyrekordbox for host config.
    rb_api.get_config = lambda *args: {}
    rb_api.get_rekordbox_pid = lambda: 0

    def connect(path=None):
        if path is not None and Path(path).resolve() != rb_path.resolve():
            raise ValueError('Review refuses non-fixture Rekordbox path')
        return Rekordbox6Database(rb_path / 'master.db', unlock=False)

    rekordbox.connection.get_rekordbox_db = connect
    config = SimpleNamespace(database=SimpleNamespace(engine_dj_path=str(engine_path), rekordbox_path=str(rb_path)),
                             export=SimpleNamespace(enabled=True))
    backend.config.get_config = lambda: config
    backend.export_gate.get_config = lambda: config
    # Real writer app-closed/backup functions remain in place, targeting decoys.

    library = create_engine(f'sqlite:///{root / "library.db"}', connect_args={'check_same_thread': False})
    from backend.database import apply_sqlite_pragmas
    event.listen(library, 'connect', apply_sqlite_pragmas)
    with library.connect() as connection:
        cfg = Config(str(ROOT / 'alembic.ini'))
        cfg.attributes.update(connection=connection, configure_logger=False)
        command.upgrade(cfg, 'head')
    from backend import models
    from tests.test_rekordbox_anlz_cues import native_pair
    from enginedj.connection import EngineDJDatabase
    from enginedj.track_export import EngineTrackSpec, insert_track
    from enginedj.models.track import Track as EngineTrack
    from enginedj.models.performance_data import PerformanceData
    from enginedj.performance_blobs import BeatData, GridMarker, encode_beat_data

    titles = ['Neon Current', 'Signal Loop', 'New Destination', 'Unavailable Audio']
    with Session(library) as db:
        playlist = models.Playlist(name='Integration Set')
        db.add(playlist)
        db.flush()
        seeded = []
        for index, title in enumerate(titles):
            # Two real files with the same basename exercise review/dispatch
            # exact identity rather than an accidental basename-only success.
            audio = root / ('first/same.flac' if index == 0 else 'second/same.flac' if index == 1
                            else f'{index + 1:02d}-{title.replace(" ", "-")}.flac')
            audio.parent.mkdir(parents=True, exist_ok=True)
            if index != 3:
                shutil.copyfile(ROOT / 'tests/fixtures/silence.flac', audio)
            track = models.Track(filename=str(audio), title=title, artist='Generated fixture', key=7 + index,
                                 energy=3, duration_secs=4.0, cue_point_time=0.2)
            db.add(track)
            db.flush()
            db.add(models.PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=index))
            db.add(models.HotCue(track_id=track.id, slot_number=1, time_seconds=0.1, label='Point', color='#FF0000'))
            seeded.append((track.id, audio, title))
        db.commit()
    rb = connect()
    engine = EngineDJDatabase(engine_path)
    for ident, audio, title in seeded[:2]:
        content = rb.add_content(audio, Title=title)
        dat, _ext = native_pair(rb_path / 'share' / str(ident))
        content.AnalysisDataPath = f'/{ident}/{dat.name}'
        with engine.session_m_write() as db:
            external_id = insert_track(db, EngineTrackSpec(audio, title), engine_path.parent)
            row = db.get(EngineTrack, external_id)
            row.key = 1 if ident == 1 else 7
            # Generated analyzed prerequisite only for the two existing rows.
            perf = db.get(PerformanceData, external_id)
            if perf is None:
                perf = PerformanceData(trackId=external_id)
                db.add(perf)
            perf.beatData = encode_beat_data(BeatData(44100.0, 176400.0,
                [GridMarker(0.0, 0, 4), GridMarker(88200.0, 4, 0)], [], True, b'\0' * 9))
    rb.commit(autoinc=True)
    rb.close()
    engine.m_engine.dispose()
    engine.m_engine_write.dispose()

    app = FastAPI(title='442 disposable Library/export integration')
    from backend.database import get_db
    from backend.routers import (tracks, playlists, tags, sync_fields, sync_export,
                                 track_links, transitions, sets, harmony, hotcues,
                                 waveforms, beatgrids, sessions, settings, analyze)

    def session():
        with Session(library) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.include_router(tracks.router, prefix='/api/tracks')
    app.include_router(playlists.router, prefix='/api/playlists')
    app.include_router(tags.router, prefix='/api/tags')
    app.include_router(sync_fields.router, prefix='/api')
    for name, router in [('track-links', track_links.router), ('transitions', transitions.router),
                         ('sets', sets.router), ('harmony', harmony.router), ('hotcues', hotcues.router),
                         ('waveforms', waveforms.router), ('beatgrids', beatgrids.router),
                         ('sessions', sessions.router), ('settings', settings.router)]:
        app.include_router(router, prefix=f'/api/{name}')
    app.include_router(analyze.router, prefix='/api/analyze')
    # Only reviewed inspector routes from this router are needed; deny the
    # unrelated legacy performance writes in the fixture middleware below.
    app.include_router(sync_export.router, prefix='/api')

    @app.middleware('http')
    async def boundary(request, call_next):
        from starlette.responses import JSONResponse
        allowed = {'/api/sync/fields/plan', '/api/sync/fields/execute',
                   '/api/sync/export/playlists/execute',
                   '/api/sessions/recover', '/api/settings/trackListSort',
                   '/fixture/gate', '/fixture/remove-ext'}
        if request.method != 'GET' and request.url.path not in allowed:
            return JSONResponse({'detail': 'Only reviewed fixture operations are enabled'}, status_code=403)
        return await call_next(request)

    @app.get('/source.json')
    @app.get('/fixture/identity')
    def identity():
        return {'fixture': 'library-export-442', 'pin': pin, 'library': 'Alembic disposable SQLite',
                'external_adapters': 'production on generated Engine/pyrekordbox SQLite + native-layout DAT/EXT',
                'fixture_root': str(root), 'engine_identity_fixture': True,
                'installed_app': False, 'encrypted_library': False,
                'usb': False, 'audio': 'committed silence fixture copies only'}

    @app.get('/api/config')
    def app_config():
        return {'export_enabled': config.export.enabled, 'ffmpeg_available': shutil.which('ffmpeg') is not None}

    @app.post('/fixture/gate')
    def gate(enabled: bool):
        config.export.enabled = enabled
        return app_config()

    @app.post('/fixture/remove-ext')
    def remove_ext():
        # One named generated file only; cannot accept any caller-supplied path.
        (rb_path / 'share/1/ANLZ0000.EXT').unlink(missing_ok=True)
        return {'removed': 'generated track1 EXT only'}

    @app.get('/fixture/evidence')
    def evidence():
        from rekordbox.device.anlz_read import read_anlz
        rb = connect()
        try:
            contents = list(rb.get_content())
            cues = rb.session.query(tables.DjmdCue).filter(tables.DjmdCue.rb_local_deleted == 0).all()
            native = {str(p.relative_to(rb_path)): [{'hot': c.hot_cue, 'time_ms': c.time_ms}
                       for c in read_anlz(p).cues_extended] for p in sorted((rb_path / 'share').rglob('*.EXT'))}
            engine = EngineDJDatabase(engine_path)
            try:
                with engine.session_m() as db:
                    engine_rows = [{'id': row.id, 'path': row.path, 'key': row.key, 'analyzed': row.isAnalyzed}
                                   for row in db.query(EngineTrack).order_by(EngineTrack.id)]
            finally:
                engine.m_engine.dispose()
                engine.m_engine_write.dispose()
            return {'records': len(contents), 'cue_rows': [{'kind': c.Kind, 'time_ms': c.InMsec, 'out_ms': c.OutMsec} for c in cues],
                    'native': native, 'engine': engine_rows,
                    'backups': [str(p.relative_to(root)) for p in root.rglob('*-manadj-pre-write*')]}
        finally:
            rb.close()

    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--pin', required=True)
    args = parser.parse_args()
    if not args.assets.is_dir():
        raise SystemExit('Build isolated assets first')
    root = Path(tempfile.mkdtemp(prefix='manadj-export442-', dir='/tmp/opencode'))
    app = create_review(root, args.pin)
    # No production backend startup/tasks/websocket/device services are mounted.
    app.mount('/', StaticFiles(directory=args.assets, html=True))
    uvicorn.run(app, host='127.0.0.1', port=args.port)

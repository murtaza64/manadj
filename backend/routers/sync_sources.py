"""Read-only desktop source inventory, separate from removable-media discovery."""
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.config import get_config
from backend.database import get_db
from backend.models import Track
from backend.sync_status.adapters import EngineSurfaceReader, RekordboxSurfaceReader

router = APIRouter(prefix='/sync/sources', tags=['sync'])


def read_source(source: str, path: str):
    """Read exactly the configured desktop library, never discovered drive libraries."""
    if source == 'engine':
        from enginedj.connection import EngineDJDatabase
        database = EngineDJDatabase(Path(path))
        try:
            return EngineSurfaceReader(database).list_tracks()
        finally:
            database.m_engine.dispose()
            database.m_engine_write.dispose()
            if database.hm_engine is not None:
                database.hm_engine.dispose()
    from rekordbox.connection import get_rekordbox_db
    database = get_rekordbox_db(path)
    try:
        return RekordboxSurfaceReader(database).list_tracks()
    finally:
        database.close()


def inventory(source: str, path: str | None, db: Session):
    result = {'source': source, 'status': 'not_configured', 'reason': None,
              'read_at': datetime.now(timezone.utc).isoformat(), 'tracks': [],
              'match_basis': 'exact file path only; audio identity is not verified'}
    if not path:
        return result
    try:
        refs = read_source(source, path)
        # Exact slash-normalized paths only. Case folding is unsafe across volumes.
        by_path = {}
        for track in db.query(Track).all():
            by_path.setdefault(track.filename.replace('\\', '/'), []).append(track)
        rows = []
        for ordinal, ref in enumerate(refs):
            matches = by_path.get((ref.path or '').replace('\\', '/'), [])
            track = matches[0] if len(matches) == 1 else None
            rows.append({'id': f'{source}:{ordinal}', 'path': ref.path,
                         'title': ref.fields.title, 'artist': ref.fields.artist,
                         'bpm': ref.fields.bpm, 'key': ref.fields.key,
                         'library_track_id': track.id if track else None,
                         'match': 'same-path' if track else 'ambiguous-path' if matches else 'not-in-library',
                         'library_title': track.title if track else None})
        result.update(status='read', tracks=rows)
    except Exception as exc:
        result.update(status='failed', reason=type(exc).__name__, tracks=[])
    return result


@router.get('/{source}/tracks')
def source_tracks(source: Literal['engine', 'rekordbox'], db: Session = Depends(get_db)):
    config = get_config()
    path = config.database.engine_dj_path if source == 'engine' else config.database.rekordbox_path
    return inventory(source, path, db)

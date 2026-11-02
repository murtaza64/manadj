"""Exact-ID, field-only review. Adapters own persistence and writer policies.

No playlist manager or record-creation seam is exposed. A scope label describes
the frozen IDs supplied by the caller; it never invokes a whole-library writer.
"""
from collections.abc import Callable
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
from threading import Lock
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from backend import models
from backend.playlist_export_inspector import _locks as export_locks
from backend.sync_common.matching import TrackIndex
from backend.sync_status.compare import beatgrid_value_from_row, hotcue_values_from_rows
from backend.sync_status.models import SurfaceTrackRef

FieldName = Literal['title', 'artist', 'key', 'bpm', 'energy', 'tags', 'hotcues', 'beatgrid', 'maincue']


class FieldReviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, strict=True)

    track_ids: list[int] = Field(min_length=1, max_length=10000)
    scope: Literal['selected', 'filtered', 'all']
    surface: Literal['engine', 'rekordbox']
    direction: Literal['import', 'export']
    fields: list[FieldName] = Field(min_length=1)

    @field_validator('track_ids', 'fields')
    @classmethod
    def unique(cls, values):
        if len(set(values)) != len(values):
            raise ValueError('Scope IDs and fields must be unique')
        if any(isinstance(v, int) and v <= 0 for v in values):
            raise ValueError('Track IDs must be positive')
        return values


@dataclass(frozen=True)
class FieldSnapshot:
    identity: str
    revision: str
    tracks: list[SurfaceTrackRef]
    known_fields: set[str]
    supported_fields: set[str]


class FieldPlanUnavailable(ValueError):
    pass


class StaleFieldPlan(ValueError):
    pass


class FieldReviewBusy(ValueError):
    pass


_import_lock = Lock()


def _blank(value):
    return value is None or value == '' or value == []


def _library_values(track):
    grid = beatgrid_value_from_row(track.beatgrid)
    return {'title': track.title, 'artist': track.artist, 'key': track.key,
            'bpm': track.bpm / 100 if track.bpm is not None else None,
            'energy': track.energy, 'tags': sorted(tt.tag.name for tt in track.track_tags),
            'hotcues': [asdict(cue) for cue in hotcue_values_from_rows(track.hotcues)],
            'beatgrid': asdict(grid) if grid else None, 'maincue': track.cue_point_time}


class FieldReview:
    def __init__(self, db: Session, read: Callable[[str, str], FieldSnapshot],
                 write: Callable[[str, str, str, int, str, object], dict]):
        self.db, self.read, self.write = db, read, write

    def preview(self, request: FieldReviewRequest) -> dict:
        # Revalidate copies too: callers must not bypass invariants via model_copy.
        request = FieldReviewRequest.model_validate(request.model_dump())
        self.db.expire_all()
        tracks = {t.id: t for t in self.db.query(models.Track).filter(models.Track.id.in_(request.track_ids))}
        if set(tracks) != set(request.track_ids):
            raise FieldPlanUnavailable('One or more captured Library tracks no longer exist; reselect and review')
        snapshot = self.read(request.surface, request.direction)
        index = TrackIndex.build(snapshot.tracks, lambda track: track.path)
        rows, source = [], []
        for track_id in request.track_ids:
            track = tracks[track_id]
            library = _library_values(track)
            hit = index.match(track.filename)
            external = asdict(hit.fields) if hit else {}
            try:
                stat = Path(track.filename).stat()
                media = [stat.st_size, stat.st_mtime_ns]
            except OSError:
                media = None
            grid = track.beatgrid
            # Import replaces provenance and clears the anchor, not just tempo
            # values. Bind that affected saved state before allowing dispatch.
            grid_revision = None if grid is None else {
                'id': grid.id, 'origin': grid.origin, 'anchor_time': grid.anchor_time,
                'tempo_changes_json': grid.tempo_changes_json,
                'updated_at': grid.updated_at.isoformat() if grid.updated_at else None,
            }
            source.append({'id': track.id, 'filename': track.filename, 'active': track.is_active,
                            'values': library, 'media': media,
                            'grid_revision': grid_revision if 'beatgrid' in request.fields else None,
                            'duration': track.duration_secs or getattr(track.waveform, 'duration', None)})
            changes = []
            for field in request.fields:
                before, after = ((library[field], external.get(field)) if request.direction == 'import'
                                 else (external.get(field), library[field]))
                known = request.direction == 'import' or field in snapshot.known_fields
                if request.direction == 'export' and field in ('hotcues', 'beatgrid', 'tags') and before is None:
                    known = False
                reason = None
                if not hit:
                    action, reason = 'blocked', 'Record absent or ambiguous downstream; cannot create records here (#417)'
                elif field not in snapshot.supported_fields:
                    action, reason = 'blocked', f'{field} is not supported for this surface/direction'
                elif request.direction == 'import' and field not in snapshot.known_fields:
                    action, reason = 'blocked', 'Source field is not observed; unknown is not an empty value'
                elif request.direction == 'import' and field in ('hotcues', 'beatgrid') and after is None:
                    action, reason = 'skip', 'Source field absent or unreadable; no known value to import. Destination kept.'
                elif _blank(after):
                    action, reason = 'skip', 'Source empty; destination kept. No clear proposed.'
                elif known and before == after:
                    action, reason = 'skip', 'Values agree; no write proposed'
                elif request.direction == 'export' and request.surface == 'rekordbox' and field == 'hotcues':
                    action, reason = 'consent', 'Reconcile hot/memory cue mirrors; destination-only memory cues may be deleted (prior full set unknown)'
                elif known and _blank(before):
                    action = 'fill'
                else:
                    action, reason = 'consent', 'Saved or unknown destination value; explicit per-field replacement required'
                changes.append({'field': field, 'before_known': known, 'before': before, 'after': after,
                                'action': action, 'reason': reason})
            rows.append({'track_id': track.id, 'title': track.title, 'filename': track.filename, 'fields': changes})
        warnings = ['Field data only. No playlist membership/order, track creation or audio copy.',
                    'Writer receipts do not verify native playback. No rollback or safe retry is promised.']
        if request.direction == 'import' and 'beatgrid' in request.fields:
            warnings.append('Beatgrid import updates the Library BPM projection and clears its old anchor.')
        if request.direction == 'export' and request.surface == 'rekordbox' and 'hotcues' in request.fields:
            warnings.append('Rekordbox hot-cue export reconciles DB hot/memory mirrors; destination-only memory cues may be deleted. Prior full memory set is not observed.')
        plan = {**request.model_dump(), 'destination': snapshot.identity, 'tracks': rows,
                'executable': not any(f['action'] == 'blocked' for row in rows for f in row['fields']), 'warnings': warnings}
        payload = {'plan': plan, 'source': source, 'revision': snapshot.revision}
        plan['token'] = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        return plan

    def execute(self, request: FieldReviewRequest, token: str, replacements: list[tuple[int, str]]) -> dict:
        lock = _import_lock if request.direction == 'import' else export_locks[request.surface]
        if not lock.acquire(blocking=False):
            raise FieldReviewBusy('A field operation for this destination is already pending')
        try:
            plan = self.preview(request)
            if not token or token != plan['token']:
                raise StaleFieldPlan('Captured source, destination or scope changed; nothing started. Recheck.')
            if not plan['executable']:
                raise FieldPlanUnavailable('Resolve blocked fields/records and review again; nothing started')
            allowed = {(row['track_id'], f['field']) for row in plan['tracks'] for f in row['fields']
                       if f['action'] == 'consent'}
            consent = set(replacements)
            if len(consent) != len(replacements) or not consent <= allowed:
                raise FieldPlanUnavailable('Replacement choices do not match the reviewed pending fields')
            rows = []
            for track in plan['tracks']:
                results = {}
                dispatch = track['fields']
                if request.direction == 'export' and request.surface == 'rekordbox':
                    # Hot-cue reconciliation removes stray memory rows. The
                    # selected Main cue must be written after that reconcile.
                    # Sorting only existing fields never adds an unselected write.
                    dispatch = sorted(dispatch, key=lambda field: field['field'] == 'maincue')
                for field in dispatch:
                    if field['action'] == 'skip' or (field['action'] == 'consent' and (track['track_id'], field['field']) not in consent):
                        result = {'status': 'skipped', 'reason': field['reason'] or 'Replacement not selected'}
                    else:
                        try:
                            result = self.write(plan['destination'], request.surface, request.direction,
                                                track['track_id'], field['field'], field['after'])
                            if not isinstance(result, dict) or result.get('status') not in ('applied', 'skipped', 'failed', 'unknown'):
                                result = {'status': 'unknown', 'reason': 'Writer did not return a typed outcome'}
                        except Exception as error:
                            # Exceptions after dispatch cannot prove no write took place.
                            self.db.rollback()
                            result = {'status': 'unknown', 'reason': str(error)}
                    results[field['field']] = {'field': field['field'], **result}
                # Keep receipt identity/order in the reviewed request vocabulary.
                fields = [results[field['field']] for field in track['fields']]
                rows.append({'track_id': track['track_id'], 'title': track['title'], 'fields': fields})
            statuses = [field['status'] for row in rows for field in row['fields']]
            status = 'unknown' if 'unknown' in statuses else 'partial' if 'failed' in statuses else 'complete'
            return {**request.model_dump(), 'destination': plan['destination'], 'token': token,
                    'status': status, 'tracks': rows,
                    'verification': 'Writer report only; no independent readback or native playback check.'}
        finally:
            lock.release()

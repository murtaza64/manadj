"""Read-only visual plans and scope-bound execution for playlist Export.

The destination seam supplies observations, not write adapters. Unknown values
stay unknown; this module never infers native-file or hardware verification.
"""
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field as dataclass_field
import hashlib
import json
from pathlib import Path
from threading import Lock

from sqlalchemy.orm import Session

from backend import models
from backend.sync_common.matching import TrackIndex, path_key
from backend.sync_status.compare import beatgrid_value_from_row, hotcue_values_from_rows
from backend.sync_status.models import SurfaceTrackRef


@dataclass
class DestinationSnapshot:
    identity: str
    playlist: list[str] | None
    tracks: list[SurfaceTrackRef]
    known_fields: set[str]
    revision: str
    # Exact missing source paths observed through #417's read-only validation.
    # None means eligible to add; a string is the blocking source/path reason.
    additions: dict[str, str | None] = dataclass_field(default_factory=dict)


class PlanUnavailable(ValueError):
    pass


class StalePlan(ValueError):
    pass


class ExportInProgress(ValueError):
    pass


# One process-wide lease per external destination, shared across requests.
# Other legacy endpoints/processes are not covered; revalidation is not an
# atomic external-DB transaction and never promises rollback.
_locks = {'rekordbox': Lock(), 'engine': Lock()}
FIELDS = ('hotcues', 'beatgrid', 'key', 'maincue', 'tags', 'energy')


class PlaylistExportInspector:
    def __init__(self, db: Session,
                 read: Callable[[str, str], DestinationSnapshot],
                 write: Callable[[str, str, str, str], dict]):
        self.db, self.read, self.write = db, read, write

    def preview(self, playlist_name: str, target: str, scope: str) -> dict:
        if target not in _locks or scope not in ('full', 'order'):
            raise PlanUnavailable('Unsupported destination or scope')
        self.db.expire_all()
        playlists = self.db.query(models.Playlist).filter_by(name=playlist_name).all()
        if len(playlists) != 1:
            raise PlanUnavailable('Playlist not found or name is ambiguous; rename duplicates first')
        playlist = playlists[0]
        member_ids = [row.track_id for row in self.db.query(models.PlaylistTrack)
                      .filter_by(playlist_id=playlist.id).order_by(models.PlaylistTrack.position, models.PlaylistTrack.id)]
        if len(member_ids) != len(set(member_ids)):
            raise PlanUnavailable('Repeated tracks are not supported by this exporter; remove repeated playlist entries first')
        tracks = (self.db.query(models.Track).join(models.PlaylistTrack)
                  .filter(models.PlaylistTrack.playlist_id == playlist.id)
                  .order_by(models.PlaylistTrack.position, models.PlaylistTrack.id).all())
        dest = self.read(playlist_name, target)
        index = TrackIndex.build(dest.tracks, lambda t: t.path)
        catalogue = [{'id': c.id, 'name': c.name, 'color': c.color,
                      'order': c.display_order, 'tags': [
                          {'id': t.id, 'name': t.name, 'color': t.color, 'order': t.display_order}
                          for t in sorted(c.tags, key=lambda t: t.id)]}
                     for c in self.db.query(models.TagCategory).order_by(models.TagCategory.id)]
        known_tag_names = {t['name'] for c in catalogue for t in c['tags']}
        rows, final, source = [], [], []
        for track in tracks:
            match_path = track.filename
            if target == 'engine':
                from enginedj.paths import absolute_track_path
                match_path = absolute_track_path(match_path, Path(dest.identity).parent)
            hit = index.match(match_path)
            can_add = not hit and track.filename in dest.additions and dest.additions[track.filename] is None
            record_reason = dest.additions.get(track.filename) if not hit else None
            grid = beatgrid_value_from_row(track.beatgrid)
            values = {'hotcues': [asdict(c) for c in hotcue_values_from_rows(track.hotcues)],
                      'beatgrid': asdict(grid) if grid else None, 'key': track.key,
                      'maincue': track.cue_point_time,
                      'tags': sorted(tt.tag.name for tt in track.track_tags),
                      'energy': track.energy}
            duration = track.duration_secs or getattr(track.waveform, 'duration', None)
            try:
                stat = Path(track.filename).stat()
                media_revision = [stat.st_size, stat.st_mtime_ns]
            except OSError:
                media_revision = None
            source.append({'id': track.id, 'filename': track.filename, 'title': track.title,
                           'matched_destination': {'path': hit.path, 'identity': hit.identity} if hit else None,
                           'active': track.is_active, 'duration': duration, 'values': values,
                           'media_revision': media_revision})
            if hit:
                final.append(hit.path)
            elif can_add:
                final.append(track.filename)
            changes = []
            for field in FIELDS if scope == 'full' else ():
                before = asdict(hit.fields)[field] if hit else None
                known = bool(hit and field in dest.known_fields)
                # Reader None for cue/grid can mean undecodable/unavailable,
                # not a measured empty set. Never show it as zero cues.
                if field in ('beatgrid', 'hotcues', 'tags') and before is None:
                    known = False
                after, reason = values[field], None
                action = 'replace'
                if not hit and not can_add:
                    action, reason = 'blocked', record_reason or 'Missing destination record cannot be prepared'
                elif ((field in ('key', 'beatgrid') and after is None)
                      or (target == 'engine' and field == 'energy' and after is None)
                      or (target == 'engine' and field == 'beatgrid' and not duration)
                      or (target == 'engine' and field == 'tags' and not track.is_active)):
                    action, reason = 'skip', 'No saved Library value (or inactive Engine tag scope)'
                else:
                    if target == 'engine' and field == 'tags' and known:
                        # The Engine writer only replaces current Library-tag
                        # memberships, preserving foreign/obsolete tag lists.
                        after = sorted(set(after) | (set(before or []) - known_tag_names))
                    if after is None or after == []:
                        action = 'clear'
                    elif not known:
                        action = 'replace-unknown'
                    elif before == after:
                        action = 'unchanged'
                    if field in ('beatgrid', 'hotcues', 'maincue'):
                        reason = 'Native analysis/sample-rate prerequisites are checked by the writer; a write can fail or skip'
                changes.append({'field': field, 'before_known': known, 'before': before,
                                'after': after, 'action': action, 'reason': reason})
            if target == 'rekordbox' and scope == 'full':
                # The existing hot-cue writer reconciles memory mirrors too.
                # The reader exposes mirror agreement, not every memory row;
                # do not pretend that an unobserved memory set is empty.
                memory_positions = {c['time'] for c in values['hotcues']}
                if track.cue_point_time is not None:
                    memory_positions.add(track.cue_point_time)
                changes.append({'field': 'memorycues', 'before_known': False, 'before': None,
                                'after': sorted(memory_positions),
                                'action': 'blocked' if not hit and not can_add else 'replace-unknown' if memory_positions else 'clear',
                                'reason': 'Desktop DB export replaces memory cues with hot-cue mirrors plus the Library Main cue. Destination-only memory cues may be deleted; prior memory positions are not observed. Native cue-file readback is not checked.'})
            rows.append({'track_id': track.id, 'title': track.title or track.filename,
                         'filename': track.filename, 'duration': duration,
                          'record_action': 'existing' if hit else 'create' if can_add else 'blocked',
                          'record_reason': record_reason, 'fields': changes})
        before = dest.playlist or []
        old_counts, new_counts = Counter(map(path_key, before)), Counter(map(path_key, final))
        adds, removes = new_counts - old_counts, old_counts - new_counts

        def occurrences(paths, counts):
            budget, result = counts.copy(), []
            for path in paths:
                if budget[path_key(path)] > 0:
                    result.append(path)
                    budget[path_key(path)] -= 1
            return result

        common = old_counts & new_counts
        plan = {'playlist_name': playlist_name, 'playlist_id': playlist.id,
                'source': 'Library', 'target': target, 'scope': scope,
                'destination': dest.identity, 'executable': (all(r['record_action'] in ('existing', 'create') for r in rows)
                    or bool(dest.additions) and any(r['record_action'] != 'blocked' for r in rows)),
                'membership': {'create': dest.playlist is None, 'before': before, 'after': final,
                               'added': occurrences(final, adds), 'removed': occurrences(before, removes),
                               'moved': sum(path_key(a) != path_key(b) for a, b in zip(
                                   occurrences(before, common), occurrences(final, common)))},
                'tracks': rows,
                'tag_structure': catalogue if scope == 'full' else [],
                'warnings': ['Membership removals do not delete source tracks or audio.',
                             'Track fields are shared with other destination playlists.',
                             'Full export may create/update the destination tag structure; its prior structure is not compared.'] if scope == 'full' else ['Playlist membership/order only; cues and metadata are unchanged.']}
        if dest.additions:
            plan['warnings'] += ['Missing destination records are added before playlist membership; no audio is copied. New records have no fabricated analysis. Cue/grid writes may fail or skip until analyzed.']
        if any(row['record_action'] == 'blocked' for row in rows):
            plan['warnings'] += ['Unavailable tracks are omitted from destination playlist membership. Their failures remain in the receipt; successful record additions are not rolled back.']
        # Source data, destination read state, destination file revision and
        # exact context all bind execution. This is a freshness token, not an
        # auth token; the normal export gate remains authoritative.
        payload = {'plan': plan, 'source': source, 'destination_revision': dest.revision}
        plan['token'] = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        return plan

    def execute(self, playlist_name: str, target: str, scope: str, token: str) -> dict:
        if target not in _locks:
            raise PlanUnavailable('Unsupported destination')
        lock = _locks[target]
        if not lock.acquire(blocking=False):
            raise ExportInProgress('An inspector export to this destination is already in progress')
        try:
            plan = self.preview(playlist_name, target, scope)
            if not token or plan['token'] != token:
                raise StalePlan('Source or destination changed. Recheck and review a new plan; nothing started.')
            if not plan['executable']:
                raise PlanUnavailable('Tracks are absent downstream. Resolve blocked records and recheck; nothing started.')
            return self.write(playlist_name, target, scope, plan['destination'])
        finally:
            lock.release()


def build_playlist_export_inspector(db: Session) -> PlaylistExportInspector:
    """Production read/write wiring. Preview never instantiates a writer."""
    from backend.config import get_config
    from backend.playlist_full_export import build_playlist_full_export_service
    from backend.playlists.sync_manager import PlaylistSyncManager
    from backend.sync_status.adapters import EngineSurfaceReader, RekordboxSurfaceReader

    def read(name: str, target: str) -> DestinationSnapshot:
        config = get_config().database
        raw = config.rekordbox_path if target == 'rekordbox' else config.engine_dj_path
        if not raw:
            raise PlanUnavailable(f'{target} library is not configured')
        path = Path(raw).resolve()
        if not path.is_dir():
            raise PlanUnavailable(f'{target} library is unavailable: {path}')
        rb_db, engine_db = None, None
        try:
            if target == 'rekordbox':
                if not (path / 'master.db').is_file():
                    raise PlanUnavailable('Rekordbox master.db is unavailable')
                from rekordbox.connection import get_rekordbox_db
                rb_db = get_rekordbox_db(path)
                reader = RekordboxSurfaceReader(rb_db)
            else:
                from enginedj.connection import EngineDJDatabase
                engine_db = EngineDJDatabase(path)
                reader = EngineSurfaceReader(engine_db)
            manager = PlaylistSyncManager(db, engine_db=engine_db, rb_db=rb_db)
            dest_playlists = manager.load_all_playlists()[target]
            matched = [p for p in dest_playlists if p.name == name]
            if len(matched) > 1:
                raise PlanUnavailable('Destination playlist name is ambiguous; rename duplicates first')
            refs = reader.list_tracks()
            ref_index = TrackIndex.build(refs, lambda ref: ref.path)
            from backend.playlists.track_export import validate_track_source
            additions = {}
            source = next((p for p in manager.manadj_reader.get_all_playlists() if p.name == name), None)
            for ref in source.tracks if source else ():
                match_path = ref.path
                if target == 'engine':
                    from enginedj.paths import absolute_track_path
                    match_path = absolute_track_path(match_path, path.parent)
                if ref_index.match(match_path) is None:
                    try:
                        validate_track_source(manager, target, ref)
                        additions[ref.path] = None
                    except Exception as error:
                        additions[ref.path] = str(error)
            # Includes DB/WAL and native-analysis stat changes even for fields
            # a reader cannot decode (e.g. Rekordbox Main cue). No file writes.
            stats = []
            for file in sorted(path.rglob('*')):
                name = file.name.lower()
                # SHM is an observation-created coordination index, not data.
                # An absent WAL and an empty WAL both contain no changes.
                # Opening the last closed WAL DB can recreate both sidecars.
                if file.is_file() and (name.endswith(('.db', '.db-wal')) or file.suffix.upper() in {'.DAT', '.EXT', '.2EX'}):
                    stat = file.stat()
                    if name.endswith('.db-wal') and stat.st_size == 0:
                        continue
                    stats.append((str(file.relative_to(path)), stat.st_size, stat.st_mtime_ns))
            return DestinationSnapshot(
                str(path.resolve()), [t.path for t in matched[0].tracks] if matched else None,
                refs, set(reader.fields), json.dumps(stats), additions,
            )
        except PlanUnavailable:
            raise
        except Exception as error:
            raise PlanUnavailable(f'Could not read {target}: {error}') from error
        finally:
            if rb_db is not None:
                rb_db.close()
            if engine_db is not None:
                engine_db.m_engine.dispose()
                engine_db.m_engine_write.dispose()
                if engine_db.hm_engine is not None:
                    engine_db.hm_engine.dispose()

    def write(name: str, target: str, scope: str, destination: str) -> dict:
        if scope == 'full':
            # Existing writer semantics, including clears/skips and backups.
            return build_playlist_full_export_service(db, destination_paths={target: destination}).export(name, [target])
        rb_db, engine_db = None, None
        try:
            if target == 'rekordbox':
                from rekordbox.connection import get_rekordbox_db
                from rekordbox.perf_export import ensure_rekordbox_closed, snapshot_library
                ensure_rekordbox_closed()
                path = Path(destination)
                snapshot_library(path)
                rb_db = get_rekordbox_db(path)
            else:
                from enginedj.connection import EngineDJDatabase
                from enginedj.track_export import ensure_engine_closed, snapshot_database
                ensure_engine_closed()
                path = Path(destination)
                snapshot_database(path)
                engine_db = EngineDJDatabase(path)
            result = PlaylistSyncManager(db, engine_db, rb_db, destination_paths={target: destination}).sync_playlist_to_target(
                name, 'manadj', target, ignore_missing_tracks=True)
            tracks = (db.query(models.Track).join(models.PlaylistTrack).join(models.Playlist)
                      .filter(models.Playlist.name == name).order_by(models.PlaylistTrack.position).all())
            unmatched = set(result.unmatched_track_ids)
            def row_result(track):
                failed = not result.success or track.id in unmatched
                return {'track_id': track.id, 'title': track.title,
                        'status': 'failed' if failed else 'exported',
                        'reason': result.track_errors.get(Path(track.filename).name) if track.id in unmatched else result.error,
                        'fields': {'playlist': 'failed' if failed else 'exported'}}
            rows = [row_result(track) for track in tracks]
            failed = sum(row['status'] == 'failed' for row in rows)
            return {'playlist_name': name, 'results': [{
                'target': target, 'status': 'failed' if not result.success else 'partial' if failed else 'exported',
                'tracks_added': result.tracks_added,
                'playlist_created': result.created, 'tracks_total': len(tracks),
                'tracks_exported': len(tracks) - failed,
                'tracks_skipped': 0, 'tracks_failed': failed,
                'error': result.error, 'tracks': rows,
            }]}
        finally:
            if rb_db is not None:
                rb_db.close()
            if engine_db is not None:
                engine_db.m_engine.dispose()
                engine_db.m_engine_write.dispose()
                if engine_db.hm_engine is not None:
                    engine_db.hm_engine.dispose()

    return PlaylistExportInspector(db, read, write)

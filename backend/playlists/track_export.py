"""Create missing downstream tracks before replacing playlist membership."""

from pathlib import Path

from backend.sync_common.matching import path_key

from .models import PlaylistInfo, SyncResult, TrackReference


def _source_audio(ref: TrackReference) -> Path:
    path = Path(ref.path)
    if not ref.path or not path.is_file():
        raise ValueError(f"Source audio is not an existing regular file: {ref.path}")
    # Opening, rather than access(), also catches permission and I/O failures.
    with path.open("rb") as audio:
        audio.read(1)
    return path


def validate_track_source(manager, target: str, ref: TrackReference) -> Path:
    """Read-only creation prerequisites shared by dry-run and the inspector."""
    path = _source_audio(ref)
    if target == "engine":
        from enginedj.track_export import engine_relative_path

        engine_relative_path(path, Path(manager.engine_db.database_path).parent)
    return path


def _prepare(manager, target: str) -> None:
    if target == "engine":
        from enginedj.track_export import ensure_engine_closed, snapshot_database

        if manager.engine_db is None:
            raise ValueError("Engine DJ database not available")
        ensure_engine_closed()
        snapshot_database(Path(manager.engine_db.database_path))
    else:
        from backend.config import get_config
        from rekordbox.perf_export import ensure_rekordbox_closed, snapshot_library

        if manager.rb_db is None:
            raise ValueError("Rekordbox database not available")
        ensure_rekordbox_closed()
        pinned = manager.destination_paths.get('rekordbox')
        snapshot_library(Path(pinned if pinned is not None else get_config().database.rekordbox_path))


def _insert(manager, target: str, ref: TrackReference):
    path = _source_audio(ref)
    if target == "engine":
        from enginedj.models.track import Track
        from enginedj.track_export import EngineTrackSpec, insert_track

        with manager.engine_db.session_m_write() as session:
            track_id = insert_track(
                session,
                EngineTrackSpec(abs_path=path, title=ref.title or path.stem, artist=ref.artist),
                Path(manager.engine_db.database_path).parent,
            )
            session.flush()
            row = session.get(Track, track_id)
            session.expunge(row)
        return row
    try:
        row = manager.rb_db.add_content(path, Title=ref.title or path.stem)
        manager.rb_db.commit(autoinc=True)
        return row
    except Exception:
        # Clears both the SQLAlchemy transaction and pyrekordbox's registry buffer.
        manager.rb_db.rollback()
        raise


def sync_downstream_playlist(
    manager, playlist: PlaylistInfo, target: str, ignore_missing: bool, dry_run: bool
) -> SyncResult:
    result = SyncResult(target, False, False, 0, [])
    slots = []
    missing = {}
    invalid = set()
    # Resolve each reference independently before inserting anything. A failed
    # filename must not suppress a different reference with the same basename.
    for ref in playlist.tracks:
        rows, _ = manager.match_tracks_to_target(target, [ref])
        slots.append(rows[0] if rows else None)
        if not rows:
            missing.setdefault(path_key(ref.path), ref)

    for key, ref in missing.items():
        try:
            validate_track_source(manager, target, ref)
        except Exception as exc:
            invalid.add(key)
            result.track_errors[ref.filename] = str(exc)
        else:
            result.tracks_to_add.append(ref.filename)

    def failures():
        result.tracks_unmatched = [
            ref.filename for ref, row in zip(playlist.tracks, slots) if row is None
        ]
        result.error = (
            f"Some tracks could not be created in {target}. "
            "Set ignore_missing_tracks=true to proceed."
        )

    def record_unmatched_ids():
        result.unmatched_track_ids = [
            ref.track_id for ref, row in zip(playlist.tracks, slots)
            if row is None and ref.track_id is not None
        ]

    if result.track_errors and not ignore_missing:
        failures()
        record_unmatched_ids()
        return result
    if dry_run:
        result.success = True
        result.tracks_synced = sum(row is not None for row in slots) + sum(
            row is None and path_key(ref.path) not in invalid
            for ref, row in zip(playlist.tracks, slots)
        )
        result.tracks_unmatched = [
            ref.filename for ref, row in zip(playlist.tracks, slots)
            if row is None and path_key(ref.path) in invalid
        ]
        result.unmatched_track_ids = [
            ref.track_id for ref, row in zip(playlist.tracks, slots)
            if row is None and path_key(ref.path) in invalid and ref.track_id is not None
        ]
        return result

    try:
        # Membership is a write too, including when every track already exists.
        _prepare(manager, target)
        created = {}
        for key, ref in missing.items():
            if key in invalid:
                continue
            try:
                created[key] = _insert(manager, target, ref)
                result.tracks_added.append(ref.filename)
            except Exception as exc:
                result.track_errors[ref.filename] = str(exc)
        slots = [
            row if row is not None else created.get(path_key(ref.path))
            for ref, row in zip(playlist.tracks, slots)
        ]
        if any(row is None for row in slots) and not ignore_missing:
            failures()
            record_unmatched_ids()
            return result
        result.tracks_unmatched = [
            ref.filename for ref, row in zip(playlist.tracks, slots) if row is None
        ]
        record_unmatched_ids()
        tracks = [row for row in slots if row is not None]
        writer = manager._sync_to_engine if target == "engine" else manager._sync_to_rekordbox
        _, result.created = writer(playlist.name, tracks)
        result.tracks_synced = len(tracks)
        result.success = True
    except Exception as exc:
        result.error = str(exc)
        result.tracks_unmatched = [
            ref.filename for ref, row in zip(playlist.tracks, slots) if row is None
        ]
        if target == "rekordbox" and manager.rb_db is not None:
            manager.rb_db.rollback()
    return result

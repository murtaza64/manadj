"""Track sync execution helpers for API endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.key import Key
from backend.models import Track as ManAdjTrack
from rekordbox.sync import (
    find_missing_tracks_in_manadj_from_rekordbox,
    find_missing_tracks_in_rekordbox,
)

from .models import EngineTrackExportResult, RekordboxTrackSyncResult


def default_needs_analysis_playlist_name() -> str:
    """Return default needs-analysis playlist name."""
    date_str = datetime.now().strftime("%Y-%m-%d")
    return f"manadj - Needs Analysis [{date_str}]"


def _file_tags(path: Path) -> dict:
    """Best-effort album/genre/year/comment from the file's own tags —
    manadj doesn't model these, but Engine displays them and won't
    re-read tags for rows marked isMetadataImported."""
    try:
        import mutagen

        mf = mutagen.File(path, easy=True)
        if mf is None:
            return {}

        def tag(k: str) -> str | None:
            v = mf.get(k) or [None]
            return v[0]

        year = None
        if tag("date"):
            try:
                year = int(str(tag("date"))[:4])
            except ValueError:
                year = None
        return {
            "album": tag("album"),
            "genre": tag("genre"),
            "year": year,
            "length_secs": int(mf.info.length) if mf.info.length else None,
            "bitrate_kbps": int(getattr(mf.info, "bitrate", 0) / 1000) or None,
        }
    except Exception:
        return {}


def export_tracks_to_engine(
    manadj_session,
    engine_db: Any,
    playlist_name: str | None = None,
    validate_files: bool = True,
) -> EngineTrackExportResult:
    """Directly insert manadj-only tracks into Engine's m.db and collect
    them in a needs-analysis playlist. Caller is responsible for the
    Engine-closed guard and pre-write snapshot (router dependency)."""
    from enginedj.sync import find_missing_tracks_in_enginedj
    from enginedj.track_export import EngineTrackSpec, insert_track

    library_root = engine_db.database_path.parent

    with engine_db.session_m() as edj_session:
        missing, stats = find_missing_tracks_in_enginedj(
            manadj_session,
            edj_session,
            validate_paths=validate_files,
        )

    inserted_ids: list[int] = []
    with engine_db.session_m_write() as session:
        for track in missing:
            abs_path = Path(track.filename)
            tags = _file_tags(abs_path)
            spec = EngineTrackSpec(
                abs_path=abs_path,
                title=track.title or abs_path.stem,
                artist=track.artist,
                album=tags.get("album"),
                genre=tags.get("genre"),
                year=tags.get("year"),
                length_secs=(
                    int(track.duration_secs)
                    if track.duration_secs
                    else tags.get("length_secs")
                ),
                bitrate_kbps=track.bitrate_kbps or tags.get("bitrate_kbps"),
            )
            inserted_ids.append(insert_track(session, spec, library_root))

    final_playlist_name = playlist_name or default_needs_analysis_playlist_name()
    playlist_created = False
    if inserted_ids:

        @dataclass
        class _Ref:
            id: int

        engine_db.create_playlist(
            final_playlist_name, [_Ref(i) for i in inserted_ids]
        )
        playlist_created = True

    return EngineTrackExportResult(
        target="engine",
        exported_to_target=len(inserted_ids),
        skipped_file_not_found=stats.get("skipped_file_not_found", 0),
        playlist_name=final_playlist_name if inserted_ids else None,
        playlist_created=playlist_created,
    )


def export_tracks_to_rekordbox(
    tracks: list[ManAdjTrack],
    rb_db: Any,
    dry_run: bool = True,
) -> int:
    """Export tracks from manadj to Rekordbox."""
    if dry_run:
        return 0

    exported = 0
    for track in tracks:
        file_path = Path(track.filename)
        if not file_path.exists():
            continue

        title = track.title or file_path.stem
        rb_db.add_content(str(file_path.absolute()), Title=title)
        exported += 1

    if exported > 0:
        rb_db.commit(autoinc=True)

    return exported


def create_needs_analysis_playlist(
    tracks: list[ManAdjTrack],
    rb_db: Any,
    playlist_name: str,
    dry_run: bool = True,
) -> bool:
    """Create a Rekordbox playlist containing exported tracks."""
    if dry_run or not tracks:
        return False

    playlist = rb_db.create_playlist(name=playlist_name)

    rb_contents = list(rb_db.get_content())
    track_paths = {t.filename for t in tracks}

    for rb_content in rb_contents:
        if rb_content.FolderPath in track_paths:
            rb_db.add_to_playlist(playlist, rb_content)

    rb_db.commit(autoinc=True)
    return True


def import_tracks_from_rekordbox(
    rb_tracks: list[Any],
    manadj_session,
    dry_run: bool = True,
) -> int:
    """Import tracks from Rekordbox to manadj."""
    if dry_run:
        return 0

    imported = 0
    for rb_track in rb_tracks:
        if not rb_track.FolderPath:
            continue

        bpm = rb_track.BPM if rb_track.BPM else None

        key = None
        if rb_track.KeyID:
            try:
                key_obj = Key.from_mixxx_id(rb_track.KeyID)
                key = key_obj.engine_id if key_obj else None
            except Exception:
                key = None

        artist = None
        if hasattr(rb_track, 'Artist') and rb_track.Artist:
            artist = rb_track.Artist.Name if hasattr(rb_track.Artist, 'Name') else None

        manadj_track = ManAdjTrack(
            filename=rb_track.FolderPath,
            title=rb_track.Title,
            artist=artist,
            bpm=bpm,
            key=key,
            energy=None,
        )

        manadj_session.add(manadj_track)
        imported += 1

    if imported > 0:
        manadj_session.commit()

    return imported


def sync_rekordbox_tracks(
    manadj_session,
    rb_db: Any,
    dry_run: bool = True,
    skip_export: bool = False,
    skip_import: bool = False,
    validate_files: bool = True,
    playlist_name: str | None = None,
) -> RekordboxTrackSyncResult:
    """Run bidirectional track sync between manadj and Rekordbox."""
    missing_in_rb = []
    export_stats = {
        'missing_count': 0,
        'skipped_file_not_found': 0,
    }
    missing_in_manadj = []

    if not skip_export:
        missing_in_rb, export_stats = find_missing_tracks_in_rekordbox(
            manadj_session,
            rb_db,
            validate_paths=validate_files,
        )

    if not skip_import:
        missing_in_manadj, _import_stats = find_missing_tracks_in_manadj_from_rekordbox(
            manadj_session,
            rb_db,
        )

    final_playlist_name = playlist_name or default_needs_analysis_playlist_name()

    exported = 0
    imported = 0
    playlist_created = False

    if not dry_run and not skip_export and missing_in_rb:
        exported = export_tracks_to_rekordbox(missing_in_rb, rb_db, dry_run=False)
        if exported > 0:
            playlist_created = create_needs_analysis_playlist(
                missing_in_rb,
                rb_db,
                final_playlist_name,
                dry_run=False,
            )

    if not dry_run and not skip_import and missing_in_manadj:
        imported = import_tracks_from_rekordbox(
            missing_in_manadj,
            manadj_session,
            dry_run=False,
        )

    return RekordboxTrackSyncResult(
        target='rekordbox',
        dry_run=dry_run,
        skipped_file_not_found=export_stats.get('skipped_file_not_found', 0),
        missing_in_target_count=export_stats.get('missing_count', 0),
        missing_in_manadj_count=len(missing_in_manadj),
        exported_to_target=exported,
        imported_to_manadj=imported,
        playlist_name=final_playlist_name if (not skip_export and (missing_in_rb or not dry_run)) else None,
        playlist_created=playlist_created,
    )

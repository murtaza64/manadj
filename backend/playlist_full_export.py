from pathlib import Path
from typing import Protocol

from sqlalchemy.orm import Session

from backend.models import Playlist, PlaylistTrack, Track


class PlaylistExportTarget(Protocol):
    def export(self, playlist: Playlist, tracks: list[Track]) -> dict: ...


class PlaylistDestinationWriter(Protocol):
    target: str

    def prepare(self, tracks: list[Track]) -> None: ...

    def replace_playlist(
        self, name: str, tracks: list[Track]
    ) -> tuple[bool, dict[int, str]]: ...

    def export_track(self, track: Track) -> dict[str, str]: ...


class PlaylistExportTargetRunner:
    def __init__(self, writer: PlaylistDestinationWriter) -> None:
        self._writer = writer

    def export(self, playlist: Playlist, tracks: list[Track]) -> dict:
        self._writer.prepare(tracks)
        created, unmatched = self._writer.replace_playlist(playlist.name, tracks)
        rows = []
        for track in tracks:
            reason = unmatched.get(track.id)
            if reason:
                rows.append(
                    {
                        "track_id": track.id,
                        "title": track.title,
                        "status": "failed",
                        "fields": {"playlist": "failed"},
                        "reason": reason,
                    }
                )
                continue
            try:
                fields = {"playlist": "exported", **self._writer.export_track(track)}
                field_values = [value for name, value in fields.items() if name != "playlist"]
                failures = [value for value in field_values if value.startswith("failed")]
                status = "failed" if failures else (
                    "skipped"
                    if field_values and all(value.startswith("skipped") for value in field_values)
                    else "exported"
                )
                rows.append(
                    {
                        "track_id": track.id,
                        "title": track.title,
                        "status": status,
                        "fields": fields,
                        "reason": "; ".join(failures) or None,
                    }
                )
            except Exception as error:
                rows.append(
                    {
                        "track_id": track.id,
                        "title": track.title,
                        "status": "failed",
                        "fields": {"playlist": "exported"},
                        "reason": str(error),
                    }
                )
        exported = sum(row["status"] == "exported" for row in rows)
        skipped = sum(row["status"] == "skipped" for row in rows)
        failed = sum(row["status"] == "failed" for row in rows)
        return {
            "target": self._writer.target,
            "status": "failed" if failed == len(rows) and rows else "partial" if failed else "exported",
            "playlist_created": created,
            "tracks_total": len(rows),
            "tracks_exported": exported,
            "tracks_skipped": skipped,
            "tracks_failed": failed,
            "tracks": rows,
        }


class PlaylistFullExportService:
    def __init__(
        self,
        db: Session,
        targets: dict[str, PlaylistExportTarget],
    ) -> None:
        self._db = db
        self._targets = targets

    def export(self, playlist_name: str, targets: list[str]) -> dict:
        playlist = (
            self._db.query(Playlist)
            .filter(Playlist.name == playlist_name)
            .first()
        )
        if playlist is None:
            raise LookupError(f"Playlist '{playlist_name}' not found")
        tracks = (
            self._db.query(Track)
            .join(PlaylistTrack, PlaylistTrack.track_id == Track.id)
            .filter(PlaylistTrack.playlist_id == playlist.id)
            .order_by(PlaylistTrack.position)
            .all()
        )
        return {
            "playlist_name": playlist.name,
            "results": [
                self._targets[target].export(playlist, tracks)
                if target in self._targets
                else {
                    "target": target,
                    "status": "failed",
                    "playlist_created": False,
                    "tracks_total": len(tracks),
                    "tracks_exported": 0,
                    "tracks_skipped": 0,
                    "tracks_failed": len(tracks),
                    "tracks": [],
                    "error": f"{target} library is not configured",
                }
                for target in targets
            ],
        }


class UnavailableTarget:
    def __init__(self, target: str, error: str) -> None:
        self._target = target
        self._error = error

    def export(self, playlist: Playlist, tracks: list[Track]) -> dict:
        return {
            "target": self._target,
            "status": "failed",
            "playlist_created": False,
            "tracks_total": len(tracks),
            "tracks_exported": 0,
            "tracks_skipped": 0,
            "tracks_failed": len(tracks),
            "tracks": [],
            "error": self._error,
        }


def _unmatched_by_id(tracks: list[Track], filenames: list[str], target: str) -> dict[int, str]:
    names = set(filenames)
    return {
        track.id: f"{Path(track.filename).name}: not found in {target}"
        for track in tracks
        if Path(track.filename).name in names
    }


class RekordboxPlaylistWriter:
    target = "rekordbox"

    def __init__(self, db: Session, rb_db, library_path: Path) -> None:
        from rekordbox.perf_export import RekordboxPerfExporter

        self._db = db
        self._rb_db = rb_db
        self._path = Path(library_path)
        self._perf = RekordboxPerfExporter(rb_db, self._path)
        self._tag_map: dict[int, str] = {}
        self._energy_colors: dict[int, str] = {}

    def prepare(self, tracks: list[Track]) -> None:
        from rekordbox.mappings import build_energy_color_map
        from rekordbox.perf_export import ensure_rekordbox_closed, snapshot_library
        from rekordbox.tag_sync import RekordboxTagSyncer

        ensure_rekordbox_closed()
        snapshot_library(self._path)
        syncer = RekordboxTagSyncer(self._rb_db, self._db)
        _categories, self._tag_map, _stats = syncer.sync_tag_structure(dry_run=False)
        self._energy_colors = build_energy_color_map(self._rb_db.session)
        self._rb_db.commit(autoinc=True)

    def replace_playlist(
        self, name: str, tracks: list[Track]
    ) -> tuple[bool, dict[int, str]]:
        from backend.playlists.sync_manager import PlaylistSyncManager

        result = PlaylistSyncManager(self._db, rb_db=self._rb_db).sync_playlist_to_target(
            name, "manadj", "rekordbox", ignore_missing_tracks=True
        )
        if not result.success:
            raise RuntimeError(result.error or "Rekordbox playlist export failed")
        return result.created, _unmatched_by_id(tracks, result.tracks_unmatched, "Rekordbox")

    def export_track(self, track: Track) -> dict[str, str]:
        from backend.sync_status.compare import beatgrid_value_from_row
        from rekordbox.tag_sync import RekordboxTagSyncer

        fields: dict[str, str] = {}
        cues = [(c.slot_number, c.time_seconds, c.label, c.color) for c in track.hotcues]
        try:
            self._perf.export_hotcues(track.filename, cues, "replace-all")
            fields["hotcues"] = "exported"
        except Exception as error:
            fields["hotcues"] = f"failed: {error}"

        try:
            self._perf.export_maincue(track.filename, track.cue_point_time)
            fields["maincue"] = (
                "exported" if track.cue_point_time is not None else "exported: cleared"
            )
        except Exception as error:
            fields["maincue"] = f"failed: {error}"

        grid = beatgrid_value_from_row(track.beatgrid)
        if grid is None or not grid.tempo_changes:
            fields["beatgrid"] = "skipped: Library has no saved grid"
        else:
            try:
                duration = track.duration_secs or getattr(track.waveform, "duration", None)
                self._perf.export_beatgrid(track.filename, grid.tempo_changes, duration)
                fields["beatgrid"] = "exported"
            except Exception as error:
                fields["beatgrid"] = f"failed: {error}"

        if track.key is None:
            fields["key"] = "skipped: Library has no key"
        else:
            try:
                self._perf.export_key(track.filename, track.key)
                fields["key"] = "exported"
            except Exception as error:
                fields["key"] = f"failed: {error}"

        try:
            RekordboxTagSyncer(self._rb_db, self._db).sync_track_tags_and_colors(
                self._tag_map, self._energy_colors, dry_run=False, track_ids=[track.id]
            )
            self._rb_db.commit(autoinc=True)
            fields["tags"] = "exported"
            fields["energy"] = "exported" if track.energy is not None else "exported: cleared"
        except Exception as error:
            fields["tags"] = f"failed: {error}"
            fields["energy"] = f"failed: {error}"
        return fields


class EnginePlaylistWriter:
    target = "engine"

    def __init__(self, db: Session, engine_db, database_path: Path) -> None:
        from enginedj.perf_export import EnginePerfExporter

        self._db = db
        self._engine_db = engine_db
        self._path = Path(database_path)
        self._perf = EnginePerfExporter(engine_db, self._path)

    def prepare(self, tracks: list[Track]) -> None:
        from backend.tags.engine_writer import EngineTagWriter
        from enginedj.track_export import ensure_engine_closed, snapshot_database

        ensure_engine_closed()
        snapshot_database(self._path)
        EngineTagWriter(self._db, self._engine_db).sync_scoped_tag_assignments(
            [track.id for track in tracks]
        )

    def replace_playlist(
        self, name: str, tracks: list[Track]
    ) -> tuple[bool, dict[int, str]]:
        from backend.playlists.sync_manager import PlaylistSyncManager

        result = PlaylistSyncManager(self._db, engine_db=self._engine_db).sync_playlist_to_target(
            name, "manadj", "engine", ignore_missing_tracks=True
        )
        if not result.success:
            raise RuntimeError(result.error or "Engine playlist export failed")
        return result.created, _unmatched_by_id(tracks, result.tracks_unmatched, "Engine DJ")

    def export_track(self, track: Track) -> dict[str, str]:
        from backend.sync_status.compare import beatgrid_value_from_row

        grid = beatgrid_value_from_row(track.beatgrid)
        duration = track.duration_secs or getattr(track.waveform, "duration", None)
        fields = self._perf.export_performance(
            track.filename,
            cues=[(c.slot_number, c.time_seconds, c.label, c.color) for c in track.hotcues],
            tempo_changes=grid.tempo_changes if grid else None,
            key=track.key,
            maincue=track.cue_point_time,
            energy=track.energy,
            duration=duration,
        )
        fields["tags"] = "exported"
        return fields


def build_playlist_full_export_service(db: Session):
    from backend.config import get_config

    config = get_config()
    targets: dict[str, PlaylistExportTarget] = {}
    if config.database.rekordbox_path:
        try:
            from rekordbox.connection import get_rekordbox_db

            targets["rekordbox"] = PlaylistExportTargetRunner(
                RekordboxPlaylistWriter(
                    db, get_rekordbox_db(), Path(config.database.rekordbox_path)
                )
            )
        except Exception as error:
            targets["rekordbox"] = UnavailableTarget("rekordbox", str(error))
    if config.database.engine_dj_path:
        try:
            from enginedj.connection import EngineDJDatabase

            engine_path = Path(config.database.engine_dj_path)
            targets["engine"] = PlaylistExportTargetRunner(
                EnginePlaylistWriter(db, EngineDJDatabase(engine_path), engine_path)
            )
        except Exception as error:
            targets["engine"] = UnavailableTarget("engine", str(error))
    return PlaylistFullExportService(db, targets)

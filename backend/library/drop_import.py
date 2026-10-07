"""Drop import: Disk Import of files/folders dropped from anywhere, in place.

Dropped paths are absolute (Electron preload resolves them); files are never
copied. Folders recurse; non-audio and hidden files are ignored; files whose
resolved path already belongs to a Track (archived included) are skipped.
Same post-import pipeline as Disk Import, except stems: a bulk drop above
the backlog guard enqueues no splits (packaged-app PRD).
"""

from pathlib import Path

from sqlalchemy.orm import Session

from .. import crud
from ..stems_tasks import BACKLOG_GUARD
from .import_manager import LibraryImportManager, build_candidate
from .models import DropImportResult
from .scanner import AUDIO_EXTENSIONS


def _is_audio(path: Path) -> bool:
    return not path.name.startswith('.') and path.suffix.lower() in AUDIO_EXTENSIONS


def collect_dropped_files(paths: list[str]) -> tuple[list[Path], int, list[str]]:
    """Expand dropped paths → (audio files, ignored count, missing paths)."""
    files: dict[str, Path] = {}
    ignored = 0
    missing: list[str] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if path.is_dir():
            # Skip hidden folders/files inside a dropped folder (.DS_Store,
            # AppleDouble ._ files, .git, ...).
            candidates = sorted(
                p for p in path.rglob('*')
                if p.is_file()
                and not any(part.startswith('.') for part in p.relative_to(path).parts)
            )
        elif path.is_file():
            candidates = [path]
        else:
            missing.append(raw)
            continue
        for candidate in candidates:
            if not _is_audio(candidate):
                ignored += 1
                continue
            resolved = candidate.resolve()
            files.setdefault(str(resolved), resolved)
    return list(files.values()), ignored, missing


def drop_import(
    db: Session,
    paths: list[str],
    playlist_id: int | None = None,
    stem_guard: int = BACKLOG_GUARD,
) -> DropImportResult:
    """Import dropped files in place; optionally append them to a playlist."""
    if playlist_id is not None and crud.get_playlist(db, playlist_id) is None:
        raise LookupError(f"playlist {playlist_id} not found")

    result = DropImportResult()
    files, result.ignored, missing = collect_dropped_files(paths)
    result.failed = len(missing)
    result.error_messages = [f"{p}: not found" for p in missing]

    # library_path is unused on this path (no directory scan).
    manager = LibraryImportManager(db, '.')
    existing = manager.existing_paths()
    new_files = [f for f in files if str(f) not in existing]
    result.skipped = len(files) - len(new_files)

    if new_files:
        candidates = [build_candidate(f) for f in new_files]
        executed = manager.import_tracks(candidates, stem_guard=stem_guard)
        result.imported = executed.imported
        result.failed += executed.errors
        result.error_messages += executed.error_messages
        result.track_ids = executed.track_ids

    if playlist_id is not None:
        for track_id in result.track_ids:
            added = crud.add_track_to_playlist(db, playlist_id, track_id)
            if added is not None and not added[1]:
                result.playlist_added += 1

    return result

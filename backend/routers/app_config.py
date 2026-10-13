"""App configuration API (packaged-app #277).

Reads and writes the settings file (config.toml in the data root) — the
editable subset surfaced in Settings -> Library — and reveals it in the OS
file manager.
Distinct from /api/settings, which stores opaque UI preferences in the DB.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import detect_engine_path, detect_rekordbox_path, get_config, reload_config
from ..data_root import logs_dir, settings_file_path
from ..settings_file import update_settings_file

router = APIRouter()


def reveal_command(path: str, select: bool, platform: str = sys.platform) -> list[str] | None:
    """OS file-manager command showing `path` (selected inside its folder
    when `select`), or None where unsupported (#309)."""
    if platform == "darwin":
        return ["open", "-R", path] if select else ["open", path]
    if platform == "win32":
        return ["explorer", f"/select,{path}"] if select else ["explorer", path]
    if platform.startswith("linux"):
        return ["xdg-open", str(PurePosixPath(path).parent) if select else path]
    return None


def _reveal(path: Path, select: bool) -> dict:
    cmd = reveal_command(str(path), select)
    if cmd is None:
        raise HTTPException(status_code=501, detail=f"Reveal is not supported on {sys.platform}")
    subprocess.Popen(cmd)
    return {"revealed": str(path)}


class AppConfigUpdate(BaseModel):
    """Fields Settings may write; omitted fields are left alone.

    Path fields: "" clears the key (Rekordbox/Engine return to auto-detect).
    """
    tracks_directory: str | None = None
    rekordbox_path: str | None = None
    engine_dj_path: str | None = None
    export_enabled: bool | None = None


def _state() -> dict:
    config = get_config()
    return {
        "tracks_directory": config.library.tracks_directory,
        "rekordbox_path": config.database.rekordbox_path,
        "rekordbox_autodetected": config.database.rekordbox_autodetected,
        "rekordbox_detected_path": detect_rekordbox_path(),
        "engine_dj_path": config.database.engine_dj_path,
        "engine_autodetected": config.database.engine_autodetected,
        "engine_detected_path": detect_engine_path(),
        "export_enabled": config.export.enabled,
        "settings_file": str(settings_file_path()),
        # ffmpeg health (packaged-app #278): checked live so installing it
        # mid-session clears the UI warning on the next config fetch.
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
    }


@router.get("")
def get_app_config() -> dict:
    return _state()


@router.put("")
def put_app_config(body: AppConfigUpdate) -> dict:
    changes = body.model_dump(exclude_none=True)
    if changes:
        update_settings_file(changes)
        reload_config()
    return _state()


@router.post("/reveal")
def reveal_settings_file() -> dict:
    """Show the settings file in the OS file manager."""
    path = settings_file_path()
    if not path.exists():
        # Materialize the commented template so there is something to reveal.
        update_settings_file({})
    return _reveal(path, select=True)


@router.post("/reveal-logs")
def reveal_logs() -> dict:
    """Open the backend log folder in the OS file manager (packaged-app #278)."""
    path = logs_dir()
    path.mkdir(parents=True, exist_ok=True)
    return _reveal(path, select=False)

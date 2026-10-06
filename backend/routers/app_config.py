"""App configuration API (packaged-app #277).

Reads and writes the settings file (config.toml in the data root) — the
editable subset surfaced in Settings -> Library — and reveals it in Finder.
Distinct from /api/settings, which stores opaque UI preferences in the DB.
"""

from __future__ import annotations

import subprocess
import sys

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import detect_rekordbox_path, get_config, reload_config
from ..data_root import settings_file_path
from ..settings_file import update_settings_file

router = APIRouter()


class AppConfigUpdate(BaseModel):
    """Fields Settings may write; omitted fields are left alone.

    Path fields: "" clears the key (Rekordbox returns to auto-detect).
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
        "export_enabled": config.export.enabled,
        "settings_file": str(settings_file_path()),
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
    """Show the settings file in Finder (macOS `open -R`)."""
    path = settings_file_path()
    if not path.exists():
        # Materialize the commented template so there is something to reveal.
        update_settings_file({})
    if sys.platform != "darwin":
        raise HTTPException(status_code=501, detail="Reveal is only supported on macOS")
    subprocess.Popen(["open", "-R", str(path)])
    return {"revealed": str(path)}

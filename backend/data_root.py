"""Data root resolution (packaged-app PRD; ADR 0043).

All mutable state lives under one data root:
  - packaged app (MANADJ_PACKAGED=1, or MANADJ_DATA_DIR set explicitly by
    the Electron shell), per OS (#309):
      macOS    ~/Library/Application Support/manaDJ
      Windows  %APPDATA%\manaDJ  (Electron's app.getPath("userData"))
      Linux    $XDG_DATA_HOME/manaDJ (~/.local/share/manaDJ)
  - dev: the repo checkout (unchanged layout)

Layout inside the root (uniform across dev and packaged):
  config.toml        app configuration (human-readable settings file)
  .env               secrets (gitignored in dev)
  data/library.db    the app database (unless MANADJ_DB_URL overrides)
  data/stems/        stem cache
  data/backups/      automatic DB backups
  logs/              backend log files

Keep this module import-light: it is imported by backend.database at import
time and by scripts.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

APP_DIRNAME = "manaDJ"


def packaged_default(
    platform: str = sys.platform,
    env: Mapping[str, str] = os.environ,
    home: Path | None = None,
) -> Path:
    """The packaged app's per-user data root on this OS."""
    home = home if home is not None else Path.home()
    if platform == "darwin":
        return home / "Library" / "Application Support" / APP_DIRNAME
    if platform == "win32":
        appdata = env.get("APPDATA")
        base = Path(appdata) if appdata else home / "AppData" / "Roaming"
        return base / APP_DIRNAME
    xdg = env.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else home / ".local" / "share"
    return base / APP_DIRNAME


PACKAGED_DEFAULT = packaged_default()


def data_root() -> Path:
    """Resolve the data root: MANADJ_DATA_DIR > packaged default > repo."""
    env = os.environ.get("MANADJ_DATA_DIR")
    if env:
        return Path(env).expanduser()
    if os.environ.get("MANADJ_PACKAGED"):
        return PACKAGED_DEFAULT
    return REPO_ROOT


def settings_file_path() -> Path:
    """The human-readable TOML settings file (config.toml)."""
    return data_root() / "config.toml"


def dotenv_path() -> Path:
    """Secrets file (KEY=VALUE lines)."""
    return data_root() / ".env"


def db_path() -> Path:
    """Default SQLite database file (MANADJ_DB_URL overrides the app's URL)."""
    return data_root() / "data" / "library.db"


def stems_dir() -> Path:
    """Default stem cache root (overridable via [stems].directory)."""
    return data_root() / "data" / "stems"


def backups_dir() -> Path:
    """Automatic DB backup directory."""
    return data_root() / "data" / "backups"


def logs_dir() -> Path:
    """Backend log directory."""
    return data_root() / "logs"

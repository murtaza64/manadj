"""Helper for connecting to Rekordbox database."""

import logging
from pathlib import Path

from pyrekordbox import config as pyrekordbox_config
from pyrekordbox.db6 import Rekordbox6Database

from backend.config import get_config

logger = logging.getLogger(__name__)


def _ensure_pyrekordbox_config(db_dir: Path) -> None:
    """Rekordbox6Database() always runs pyrekordbox's install discovery,
    which raises a bare AssertionError when Rekordbox's options.json db-path
    disagrees with the install layout (moved library, Windows path spelling
    — #309). We always pass explicit paths, so on failure seed the config
    with them instead of crashing."""
    try:
        if pyrekordbox_config.get_config("rekordbox7") or pyrekordbox_config.get_config(
            "rekordbox6"
        ):
            return
    except AssertionError:
        logger.warning("pyrekordbox discovery failed; using %s", db_dir)
    pyrekordbox_config.__config__["rekordbox7"].update(
        {"db_dir": db_dir, "db_path": db_dir / "master.db"}
    )


def get_rekordbox_db(db_dir: str | Path | None = None) -> Rekordbox6Database:
    """Get Rekordbox database connection with proper path handling.

    pyrekordbox requires both db_dir AND path to be set correctly.
    This helper ensures both are set properly.

    Args:
        db_dir: Path to Rekordbox database directory. If None, uses path from config.toml.
                If config doesn't specify a path, uses auto-detection.

    Returns:
        Rekordbox6Database instance

    Example:
        >>> from rekordbox.connection import get_rekordbox_db
        >>> rb_db = get_rekordbox_db()  # Use config.toml path
        >>> rb_db = get_rekordbox_db('data/rekordbox')  # Custom path
    """
    if db_dir is None:
        # Try to get from config
        config = get_config()
        if config.database.rekordbox_path:
            db_dir = config.database.rekordbox_path
        else:
            # Auto-detect already ran in config loading; nothing was found.
            raise ValueError(
                "Rekordbox was not found on this computer. "
                "Set its location in Settings → Library."
            )

    # Convert to Path if string
    db_path = Path(db_dir) if isinstance(db_dir, str) else db_dir

    # Set both db_dir and path (path should point to master.db)
    # This is needed because pyrekordbox has quirks with path handling
    master_db_path = db_path / "master.db"
    _ensure_pyrekordbox_config(db_path)
    return Rekordbox6Database(db_dir=db_path, path=master_db_path)

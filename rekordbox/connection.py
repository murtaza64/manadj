"""Helper for connecting to Rekordbox database."""

from pathlib import Path
from pyrekordbox.db6 import Rekordbox6Database
from backend.config import get_config


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
            # Auto-detect (uses default Rekordbox location)
            return Rekordbox6Database()

    # Convert to Path if string
    db_path = Path(db_dir) if isinstance(db_dir, str) else db_dir

    # Set both db_dir and path (path should point to master.db)
    # This is needed because pyrekordbox has quirks with path handling
    master_db_path = db_path / "master.db"
    return Rekordbox6Database(db_dir=db_path, path=master_db_path)

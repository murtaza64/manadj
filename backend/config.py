"""Configuration management for manadj."""

import tomllib
from pathlib import Path
from dataclasses import dataclass


@dataclass
class DatabaseConfig:
    """Database configuration."""
    engine_dj_path: str | None
    rekordbox_path: str | None


@dataclass
class LibraryConfig:
    """Library configuration."""
    tracks_directory: str | None


@dataclass
class AnalysisConfig:
    """Analysis configuration."""
    key_detection_backend: str = "essentia"  # "essentia" or "keyfinder"


@dataclass
class Config:
    """Application configuration."""
    database: DatabaseConfig
    library: LibraryConfig
    analysis: AnalysisConfig


def load_config() -> Config:
    """Load configuration from config.toml.

    Returns:
        Config object with all configuration values

    Raises:
        FileNotFoundError: If config.toml doesn't exist
    """
    config_path = Path(__file__).parent.parent / "config.toml"

    if not config_path.exists():
        # Return default empty config if file doesn't exist
        return Config(
            database=DatabaseConfig(
                engine_dj_path=None,
                rekordbox_path=None
            ),
            library=LibraryConfig(
                tracks_directory=None
            ),
            analysis=AnalysisConfig()
        )

    with open(config_path, "rb") as f:
        data = tomllib.load(f)

    # Parse database config
    db_config = data.get("database", {})
    engine_path = db_config.get("engine_dj_path", "")
    rekordbox_path = db_config.get("rekordbox_path", "")

    # Convert empty strings to None
    engine_path = engine_path if engine_path else None
    rekordbox_path = rekordbox_path if rekordbox_path else None

    # Parse library config
    lib_config = data.get("library", {})
    tracks_dir = lib_config.get("tracks_directory", "")
    tracks_dir = tracks_dir if tracks_dir else None

    # Parse analysis config
    analysis_config = data.get("analysis", {})
    key_backend = analysis_config.get("key_detection_backend", "essentia")

    # Validate key detection backend
    valid_backends = ["essentia", "keyfinder"]
    if key_backend not in valid_backends:
        raise ValueError(
            f"Invalid key_detection_backend: '{key_backend}'. "
            f"Must be one of: {', '.join(valid_backends)}"
        )

    return Config(
        database=DatabaseConfig(
            engine_dj_path=engine_path,
            rekordbox_path=rekordbox_path
        ),
        library=LibraryConfig(
            tracks_directory=tracks_dir
        ),
        analysis=AnalysisConfig(
            key_detection_backend=key_backend
        )
    )


# Global config instance
_config: Config | None = None


def get_config() -> Config:
    """Get or load the global config instance.

    Returns:
        Config object (cached after first load)
    """
    global _config
    if _config is None:
        _config = load_config()
    return _config


def reload_config() -> Config:
    """Force reload configuration from file.

    Returns:
        Newly loaded Config object
    """
    global _config
    _config = load_config()
    return _config

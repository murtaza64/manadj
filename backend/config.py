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
class Config:
    """Application configuration."""
    database: DatabaseConfig


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
            )
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

    return Config(
        database=DatabaseConfig(
            engine_dj_path=engine_path,
            rekordbox_path=rekordbox_path
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

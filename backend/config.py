"""Configuration management for manadj."""

import os
import tomllib
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any

from backend.acquisition.classification import ClassificationConfig
from backend.acquisition.cleanup import CleanupConfig


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
class SoundCloudConfig:
    """SoundCloud Source configuration."""
    oauth_token: str | None = None


@dataclass
class AcquisitionConfig:
    """Acquisition configuration."""
    classification: ClassificationConfig = field(default_factory=ClassificationConfig)
    cleanup: CleanupConfig = field(default_factory=CleanupConfig)


@dataclass
class Config:
    """Application configuration."""
    database: DatabaseConfig
    library: LibraryConfig
    soundcloud: SoundCloudConfig
    acquisition: AcquisitionConfig


def _load_dotenv() -> None:
    """Load KEY=VALUE lines from repo-root .env into the environment.

    Secrets live in .env (gitignored) because config.toml is committed.
    Real environment variables take precedence over .env values.
    """
    dotenv_path = Path(__file__).parent.parent / ".env"
    if not dotenv_path.exists():
        return
    for line in dotenv_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _classification_config(data: dict[str, Any]) -> ClassificationConfig:
    """Classification heuristics from [acquisition.classification], defaults otherwise."""
    section: dict[str, Any] = data.get("acquisition", {}).get("classification", {})
    defaults = ClassificationConfig()
    return ClassificationConfig(
        clip_max_duration_secs=section.get("clip_max_duration_secs", defaults.clip_max_duration_secs),
        mix_min_duration_secs=section.get("mix_min_duration_secs", defaults.mix_min_duration_secs),
        mix_keywords=section.get("mix_keywords", defaults.mix_keywords),
        clip_keywords=section.get("clip_keywords", defaults.clip_keywords),
    )


def _cleanup_config(data: dict[str, Any]) -> CleanupConfig:
    """Cleanup rules from [acquisition.cleanup], defaults otherwise."""
    section: dict[str, Any] = data.get("acquisition", {}).get("cleanup", {})
    defaults = CleanupConfig()
    return CleanupConfig(junk_patterns=section.get("junk_patterns", defaults.junk_patterns))


def _soundcloud_token(data: dict[str, Any]) -> str | None:
    """Token from the environment (or .env); config.toml fallback for convenience."""
    section: dict[str, Any] = data.get("soundcloud", {})
    return os.environ.get("SOUNDCLOUD_OAUTH_TOKEN") or section.get("oauth_token") or None


def load_config() -> Config:
    """Load configuration from config.toml.

    Returns:
        Config object with all configuration values

    Raises:
        FileNotFoundError: If config.toml doesn't exist
    """
    _load_dotenv()
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
            soundcloud=SoundCloudConfig(oauth_token=_soundcloud_token({})),
            acquisition=AcquisitionConfig()
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

    return Config(
        database=DatabaseConfig(
            engine_dj_path=engine_path,
            rekordbox_path=rekordbox_path
        ),
        library=LibraryConfig(
            tracks_directory=tracks_dir
        ),
        soundcloud=SoundCloudConfig(oauth_token=_soundcloud_token(data)),
        acquisition=AcquisitionConfig(
            classification=_classification_config(data),
            cleanup=_cleanup_config(data),
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

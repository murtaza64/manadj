"""Configuration management for manadj."""

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.acquisition.classification import ClassificationConfig
from backend.acquisition.cleanup import CleanupConfig
from backend.data_root import dotenv_path, settings_file_path, stems_dir

# Where Rekordbox keeps its database on macOS; used when the settings file
# does not pin a location (Settings shows the detected path as the default).
REKORDBOX_DEFAULT_LOCATION = Path.home() / "Library" / "Pioneer" / "rekordbox"


def detect_rekordbox_path() -> str | None:
    """Auto-detect the Rekordbox database folder (None if not installed)."""
    return str(REKORDBOX_DEFAULT_LOCATION) if REKORDBOX_DEFAULT_LOCATION.is_dir() else None


@dataclass
class DatabaseConfig:
    """Database configuration."""
    engine_dj_path: str | None
    rekordbox_path: str | None
    # True when rekordbox_path came from auto-detection, not the settings file.
    rekordbox_autodetected: bool = False


@dataclass
class LibraryConfig:
    """Library configuration."""
    tracks_directory: str | None


@dataclass
class SoundCloudConfig:
    """SoundCloud Source configuration."""
    oauth_token: str | None = None


@dataclass
class SoulseekConfig:
    """Soulseek Supplier configuration (a local slskd daemon's REST API).

    Both values set => the Supplier exists; otherwise it is absent entirely
    (no UI affordance, no task handler). See README "Soulseek Supplier (slskd)".
    """
    slskd_url: str | None = None
    api_key: str | None = None

    @property
    def configured(self) -> bool:
        return bool(self.slskd_url and self.api_key)


@dataclass
class StemsConfig:
    """Stem splitting configuration (stems map #118; storage decisions #149).

    directory: on-disk stem cache root (data/stems by default) — the first
    on-disk derived-artifact cache; filesystem is the source of truth.
    model: demucs model name (a knob — htdemucs_ft is a candidate upgrade).
    device: torch device for the split subprocess (cpu fallback ~3.8x realtime).
    """
    directory: str = ""
    model: str = "htdemucs"
    device: str = "mps"

    def __post_init__(self) -> None:
        if not self.directory:
            self.directory = str(stems_dir())


@dataclass
class ExportConfig:
    """Export to External libraries (ADR 0043): off by default.

    Gates Rekordbox/Engine WRITE surfaces (UI and endpoints); imports are
    always available. Toggled in Settings -> Library ([export] enabled).
    """
    enabled: bool = False


@dataclass
class AcquisitionConfig:
    """Acquisition configuration."""
    classification: ClassificationConfig = field(default_factory=ClassificationConfig)
    cleanup: CleanupConfig = field(default_factory=CleanupConfig)
    # Seconds the worker sleeps between download tasks, to stay under
    # SoundCloud's request budget (issue 08). 3s was assumed, not confirmed.
    download_delay_secs: float = 3.0


@dataclass
class Config:
    """Application configuration."""
    database: DatabaseConfig
    library: LibraryConfig
    soundcloud: SoundCloudConfig
    soulseek: SoulseekConfig
    acquisition: AcquisitionConfig
    stems: StemsConfig = field(default_factory=StemsConfig)
    export: ExportConfig = field(default_factory=ExportConfig)


def _load_dotenv() -> None:
    """Load KEY=VALUE lines from the data root's .env into the environment.

    Secrets live in .env (gitignored) because the settings file is committed
    in dev. Real environment variables take precedence over .env values.
    """
    path = dotenv_path()
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
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


def _download_delay_secs(data: dict[str, Any]) -> float:
    """Inter-download pacing from [acquisition], default 3s (issue 08)."""
    section: dict[str, Any] = data.get("acquisition", {})
    default = AcquisitionConfig().download_delay_secs
    return float(section.get("download_delay_secs", default))


def _stems_config(data: dict[str, Any]) -> StemsConfig:
    """[stems] section: directory/model/device knobs, defaults otherwise."""
    section: dict[str, Any] = data.get("stems", {})
    defaults = StemsConfig()
    return StemsConfig(
        directory=section.get("directory", "") or defaults.directory,
        model=section.get("model", "") or defaults.model,
        device=section.get("device", "") or defaults.device,
    )


def _soulseek_config(data: dict[str, Any]) -> SoulseekConfig:
    """[soulseek] slskd_url from config.toml; the API key from env/.env only."""
    section: dict[str, Any] = data.get("soulseek", {})
    return SoulseekConfig(
        slskd_url=section.get("slskd_url") or None,
        api_key=os.environ.get("SLSKD_API_KEY") or None,
    )


def _soundcloud_token(data: dict[str, Any]) -> str | None:
    """Token from the environment (or .env); config.toml fallback for convenience."""
    section: dict[str, Any] = data.get("soundcloud", {})
    return os.environ.get("SOUNDCLOUD_OAUTH_TOKEN") or section.get("oauth_token") or None


def _tracks_directory_override() -> str | None:
    """MANADJ_TRACKS_DIRECTORY env override for the library tracks directory.

    Lane isolation hook: config.toml is committed with Murtaza's real tracks
    directory, so empty-DB lane apps (scripts/agent/lane_app.py --empty-db)
    point the backend at a lane-local directory via this variable instead of
    the real library.
    """
    return os.environ.get("MANADJ_TRACKS_DIRECTORY") or None


def _database_config(data: dict[str, Any]) -> DatabaseConfig:
    """[database] paths; Rekordbox auto-detects when the file doesn't pin it.

    An explicit empty string disables Rekordbox (no auto-detect); a missing
    key means "find it for me".
    """
    section: dict[str, Any] = data.get("database", {})
    engine_path = section.get("engine_dj_path") or None
    autodetected = False
    if "rekordbox_path" in section:
        rekordbox_path = section["rekordbox_path"] or None
    else:
        rekordbox_path = detect_rekordbox_path()
        autodetected = rekordbox_path is not None
    return DatabaseConfig(
        engine_dj_path=engine_path,
        rekordbox_path=rekordbox_path,
        rekordbox_autodetected=autodetected,
    )


def _export_config(data: dict[str, Any]) -> ExportConfig:
    """[export] enabled: External-library writes gate, default off (ADR 0043)."""
    section: dict[str, Any] = data.get("export", {})
    return ExportConfig(enabled=bool(section.get("enabled", False)))


def load_config() -> Config:
    """Load configuration from the settings file (config.toml in the data root).

    A missing file is not an error: defaults apply (fresh packaged install).
    """
    _load_dotenv()
    config_path = settings_file_path()

    data: dict[str, Any] = {}
    if config_path.exists():
        with open(config_path, "rb") as f:
            data = tomllib.load(f)

    lib_config = data.get("library", {})
    tracks_dir = _tracks_directory_override() or lib_config.get("tracks_directory") or None

    return Config(
        database=_database_config(data),
        library=LibraryConfig(
            tracks_directory=tracks_dir
        ),
        soundcloud=SoundCloudConfig(oauth_token=_soundcloud_token(data)),
        soulseek=_soulseek_config(data),
        acquisition=AcquisitionConfig(
            classification=_classification_config(data),
            cleanup=_cleanup_config(data),
            download_delay_secs=_download_delay_secs(data),
        ),
        stems=_stems_config(data),
        export=_export_config(data),
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

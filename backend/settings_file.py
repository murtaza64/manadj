"""The settings file: app configuration as human-readable TOML (ADR 0043).

config.toml in the data root is the source of truth for app configuration
(library paths, external-library locations, the Export gate). Settings edits
it through `update_settings_file`; hand edits are equivalent — tomlkit
round-trips the document, so comments and formatting survive UI writes.

UI preferences stay in the DB `settings` table (backend/routers/settings.py);
this file is only for configuration a user could plausibly hand-edit.
"""

from __future__ import annotations

from typing import Any

import tomlkit
from tomlkit.items import Table

from backend.data_root import settings_file_path

# (section, key) pairs Settings may write. Everything else in the file is
# hand-edit territory and passes through untouched.
EDITABLE_FIELDS: dict[str, tuple[str, str]] = {
    "tracks_directory": ("library", "tracks_directory"),
    "rekordbox_path": ("database", "rekordbox_path"),
    "engine_dj_path": ("database", "engine_dj_path"),
    "export_enabled": ("export", "enabled"),
}

_FRESH_TEMPLATE = """\
# manaDJ settings file.
# Edit here or in Settings -> Library inside the app; both are equivalent.

[library]
# Folder manaDJ imports tracks from (and downloads into).
# tracks_directory = "/path/to/your/music"

[database]
# Rekordbox database folder. Leave unset to auto-detect
# (~/Library/Pioneer/rekordbox). Set to "" to disable.
# rekordbox_path = ""

# Engine DJ Database2 folder. Leave unset to disable.
# engine_dj_path = ""

[export]
# Allow manaDJ to WRITE to your Rekordbox / Engine DJ libraries.
# Off by default: importing from them is always available.
enabled = false
"""


def _document() -> tomlkit.TOMLDocument:
    path = settings_file_path()
    if path.exists():
        return tomlkit.parse(path.read_text(encoding="utf-8"))
    return tomlkit.parse(_FRESH_TEMPLATE)


def _ensure_table(doc: tomlkit.TOMLDocument, name: str) -> Table:
    if name not in doc:
        doc[name] = tomlkit.table()
    table = doc[name]
    assert isinstance(table, Table)
    return table


def update_settings_file(changes: dict[str, Any]) -> None:
    """Apply `changes` (EDITABLE_FIELDS keys) to the settings file.

    None/"" clears a path key (removes it so defaults/auto-detect apply);
    export_enabled is always written explicitly. Creates the file from a
    commented template on first write (fresh packaged install).
    """
    doc = _document()
    for field, value in changes.items():
        section, key = EDITABLE_FIELDS[field]
        table = _ensure_table(doc, section)
        if field == "export_enabled":
            table[key] = bool(value)
        elif value:
            table[key] = str(value)
        elif key in table:
            del table[key]
    path = settings_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(tomlkit.dumps(doc), encoding="utf-8")


def update_secrets(changes: dict[str, str | None]) -> None:
    """Set (str) or remove (None) KEY=VALUE lines in the data root's .env.

    The secrets counterpart of `update_settings_file` (setup guides #290/#291
    store tokens/credentials here): other lines and comments pass through,
    the file is written atomically with mode 0600, and the process
    environment is updated to match (load_config only setdefault()s from
    .env, so a removal must also leave os.environ).
    """
    import os

    from backend.data_root import dotenv_path

    path = dotenv_path()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    out: list[str] = []
    written: set[str] = set()
    for line in lines:
        stripped = line.strip()
        key = stripped.partition("=")[0].strip() if "=" in stripped and not stripped.startswith("#") else None
        if key is not None and key in changes:
            value = changes[key]
            if value is not None and key not in written:
                out.append(f"{key}={_dotenv_value(value)}")
                written.add(key)
            continue
        out.append(line)
    for key, value in changes.items():
        if value is not None and key not in written:
            out.append(f"{key}={_dotenv_value(value)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("\n".join(out) + "\n" if out else "", encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(path)
    for key, value in changes.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def _dotenv_value(value: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError("secret values must be single-line")
    # load_config strips surrounding quotes; quote anything with spaces/#.
    return f'"{value}"' if any(c in value for c in " #'\"=") else value


def read_secrets() -> dict[str, str]:
    """KEY=VALUE pairs in the data root's .env, parsed like load_config does."""
    from backend.data_root import dotenv_path

    path = dotenv_path()
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip("'\"")
    return out

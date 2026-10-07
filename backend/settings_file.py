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
        return tomlkit.parse(path.read_text())
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
    path.write_text(tomlkit.dumps(doc))

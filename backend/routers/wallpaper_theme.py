"""Wallpaper-derived theme palette (gh#470).

Serves the internal wal-palette/1 contract, adapted from the real pywal
output format. Pywal writes ~/.cache/wal/colors.json with no version marker,
keys: wallpaper, alpha, special.{background,foreground,cursor},
colors.color0..color15 (all #rrggbb).

The backend is the only side that can read the user's wallpaper-tool cache
(the frontend is a browser), so adaptation happens here. Any malformed file
is refused wholesale with a reason; nothing partially themed ever ships.
"""

import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_PALETTE_PATH = Path("~/.cache/wal/colors.json")
ENV_OVERRIDE = "MANADJ_WALLPAPER_PALETTE_PATH"


class PaletteRefusal(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _palette_path() -> Path:
    override = os.environ.get(ENV_OVERRIDE)
    return Path(override) if override else DEFAULT_PALETTE_PATH.expanduser()


def adapt_pywal_colors(doc: object) -> dict:
    """Convert a real pywal colors.json into the internal wal-palette/1 contract.

    Raises PaletteRefusal with a stable reason on any deviation; callers keep
    the current theme on refusal.
    """
    if not isinstance(doc, dict):
        raise PaletteRefusal("not-an-object")
    special = doc.get("special")
    if not isinstance(special, dict):
        raise PaletteRefusal("missing-special")
    for key in ("background", "foreground", "cursor"):
        value = special.get(key)
        if not isinstance(value, str) or not _HEX.match(value):
            raise PaletteRefusal(f"bad-special-{key}")
    colors = doc.get("colors")
    if not isinstance(colors, dict):
        raise PaletteRefusal("missing-colors")
    ansi: list[str] = []
    for i in range(16):
        value = colors.get(f"color{i}")
        if not isinstance(value, str) or not _HEX.match(value):
            raise PaletteRefusal("missing-colorN" if value is None else "bad-colorN")
        ansi.append(value.lower())
    return {
        "version": "wal-palette/1",
        "colors": {
            "background": special["background"].lower(),
            "foreground": special["foreground"].lower(),
            "cursor": special["cursor"].lower(),
            "ansi": ansi,
        },
    }


@router.get("/wallpaper-palette")
def wallpaper_palette() -> dict:
    path = _palette_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail={"reason": "no-palette-file"})
    try:
        doc = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail={"reason": "unparseable"})
    try:
        palette = adapt_pywal_colors(doc)
    except PaletteRefusal as refusal:
        raise HTTPException(status_code=422, detail={"reason": refusal.reason})
    return {"palette": palette, "mtime": path.stat().st_mtime}

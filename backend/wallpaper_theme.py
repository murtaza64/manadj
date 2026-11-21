"""Wallpaper theme source (gh#470): serve the device-local pywal palette.

The frontend cannot read ~/.cache/wal/colors.json itself, so this endpoint
is the IO boundary. It validates pywal's real output strictly and returns
the versioned wal-palette/1 contract consumed by
frontend/src/theme/walPalette.ts. Pure mapping stays in the frontend; this
module only reads, validates and normalizes.

Refusal semantics (a bad palette must never half-apply): missing file ->
404; any schema/shape problem -> 422 with a machine-readable reason. The
frontend keeps the existing coherent theme in both cases.

Path override for tests/deployments: MANADJ_WALLPAPER_PALETTE_PATH.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

WAL_PALETTE_VERSION = "wal-palette/1"
DEFAULT_PALETTE_PATH = Path.home() / ".cache" / "wal" / "colors.json"
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

router = APIRouter()


def palette_path() -> Path:
    override = os.environ.get("MANADJ_WALLPAPER_PALETTE_PATH")
    return Path(override) if override else DEFAULT_PALETTE_PATH


class PaletteRefusal(Exception):
    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


def _require_hex(value: object, where: str) -> str:
    if not isinstance(value, str) or not _HEX.match(value):
        raise PaletteRefusal("invalid-color", f"{where} must be '#rrggbb'")
    return value.lower()


def adapt_pywal_colors(doc: object) -> dict:
    """pywal colors.json -> wal-palette/1, or raise PaletteRefusal."""
    if not isinstance(doc, dict):
        raise PaletteRefusal("not-an-object", "colors.json must be a JSON object")
    special = doc.get("special")
    if not isinstance(special, dict):
        raise PaletteRefusal("missing-special", "special {background, foreground, cursor} required")
    background = _require_hex(special.get("background"), "special.background")
    foreground = _require_hex(special.get("foreground"), "special.foreground")
    cursor = _require_hex(special.get("cursor"), "special.cursor")
    colors = doc.get("colors")
    if not isinstance(colors, dict):
        raise PaletteRefusal("missing-colors", "colors {color0..color15} required")
    ansi = []
    for i in range(16):
        key = f"color{i}"
        if key not in colors:
            raise PaletteRefusal("missing-colorN", f"colors.{key} missing")
        ansi.append(_require_hex(colors[key], f"colors.{key}"))
    return {
        "version": WAL_PALETTE_VERSION,
        "colors": {"background": background, "foreground": foreground, "cursor": cursor, "ansi": ansi},
    }


def load_palette(path: Path | None = None) -> tuple[dict, float]:
    p = path or palette_path()
    if not p.is_file():
        raise FileNotFoundError(str(p))
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PaletteRefusal("unreadable", f"cannot parse {p}: {exc}") from exc
    return adapt_pywal_colors(doc), p.stat().st_mtime


@router.get("/wallpaper-palette")
def get_wallpaper_palette():
    try:
        palette, mtime = load_palette()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"reason": "no-palette-file"})
    except PaletteRefusal as refusal:
        raise HTTPException(status_code=422, detail={"reason": refusal.reason, "detail": refusal.detail})
    return {"palette": palette, "mtime": mtime}

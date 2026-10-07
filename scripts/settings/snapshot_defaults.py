#!/usr/bin/env python3
"""Re-snapshot Shipped defaults (setup-guides #293) from Murtaza's settings.

Reads the real DB's `settings` table READ-ONLY (sqlite file: URI, mode=ro)
plus config.toml, filters through the inclusion lists in
backend/shipped_defaults.py, and rewrites backend/shipped_defaults.json.
Human-run; commit the result.

Usage:
    uv run scripts/settings/snapshot_defaults.py [--db PATH] [--config PATH] [--check]
"""

import argparse
import json
import sqlite3
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

from backend import shipped_defaults  # noqa: E402

DEFAULT_DB = Path.home() / "manadj" / "data" / "library.db"
DEFAULT_CONFIG = ROOT / "config.toml"


def read_settings(db_path: Path) -> dict[str, str]:
    """Included preference rows, opened read-only (never writes the DB)."""
    uri = f"file:{db_path.resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    finally:
        conn.close()
    return {k: v for k, v in sorted(rows) if shipped_defaults.is_shipped_setting(k)}


def read_config(config_path: Path) -> dict:
    if not config_path.exists():
        return {}
    with open(config_path, "rb") as f:
        return shipped_defaults.select_config(tomllib.load(f))


def snapshot(db_path: Path, config_path: Path) -> str:
    payload = {
        "settings": read_settings(db_path),
        "config": read_config(config_path),
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--out", type=Path, default=shipped_defaults.DEFAULTS_PATH)
    parser.add_argument("--check", action="store_true", help="exit 1 if the file is stale")
    args = parser.parse_args()

    text = snapshot(args.db, args.config)
    if args.check:
        current = args.out.read_text() if args.out.exists() else ""
        if current != text:
            print(f"{args.out} is stale; re-run without --check", file=sys.stderr)
            return 1
        print(f"{args.out} is up to date")
        return 0
    args.out.write_text(text)
    data = json.loads(text)
    print(f"wrote {args.out}: {len(data['settings'])} settings, config sections {sorted(data['config'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

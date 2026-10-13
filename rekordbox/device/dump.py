"""Dump a rekordbox device export (or single file) to JSON.

Usage:
    uv run -m rekordbox.device.dump <export-root | export.pdb | ANLZnnnn.DAT> [--anlz]

Given an export root (a directory containing PIONEER/), dumps export.pdb,
exportExt.pdb (if present), and a summary of the USBANLZ tree; --anlz
includes the full parsed contents of every ANLZ file. Given a single .pdb
or ANLZ file, dumps just that file.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path
from typing import Any

from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.pdb_read import read_pdb

ANLZ_SUFFIXES = {".dat", ".ext", ".2ex"}


def _jsonable(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _jsonable(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


def _anlz_files(root: Path) -> list[Path]:
    usbanlz = root / "PIONEER" / "USBANLZ"
    if not usbanlz.is_dir():
        return []
    return sorted(
        p for p in usbanlz.rglob("*") if p.is_file() and p.suffix.lower() in ANLZ_SUFFIXES
    )


def dump_export_root(root: Path, include_anlz: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {"root": str(root)}
    pdb_path = root / "PIONEER" / "rekordbox" / "export.pdb"
    ext_path = root / "PIONEER" / "rekordbox" / "exportExt.pdb"
    if pdb_path.is_file():
        result["export_pdb"] = _jsonable(read_pdb(pdb_path))
    if ext_path.is_file():
        result["export_ext_pdb"] = _jsonable(read_pdb(ext_path))

    anlz_paths = _anlz_files(root)
    result["anlz_file_count"] = len(anlz_paths)
    if include_anlz:
        anlz_dumps = []
        for path in anlz_paths:
            try:
                anlz_dumps.append(_jsonable(read_anlz(path)))
            except Exception as exc:  # noqa: BLE001 — surface the file, keep dumping
                anlz_dumps.append({"path": str(path), "error": repr(exc)})
        result["anlz"] = anlz_dumps
    return result


def dump_path(path: Path, include_anlz: bool = False) -> dict[str, Any]:
    if path.is_dir():
        return dump_export_root(path, include_anlz=include_anlz)
    if path.suffix.lower() == ".pdb":
        return _jsonable(read_pdb(path))
    if path.suffix.lower() in ANLZ_SUFFIXES:
        return _jsonable(read_anlz(path))
    raise SystemExit(f"unsupported path: {path} (expected export root, .pdb, or ANLZ file)")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="export root, .pdb file, or ANLZ file")
    parser.add_argument(
        "--anlz", action="store_true", help="include full ANLZ contents for an export root"
    )
    args = parser.parse_args(argv)
    json.dump(dump_path(args.path, include_anlz=args.anlz), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

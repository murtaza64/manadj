"""Synchronize cue sections in existing native ANLZ files, never rebuild analysis."""
from __future__ import annotations

import os
import stat
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path

from rekordbox.cue_mapping import CUE_PALETTE, KIND_TO_SLOT, LEGACY_MEMORY_KIND, MEMORY_KIND
from rekordbox.device.anlz_write import (
    NO_TIME,
    CueEntry,
    CueExtendedEntry,
    CueExtendedListSection,
    CueListSection,
)

# Nearest native 1..62 hot-cue color codes for the desktop palette RGBs.
# These are NOT DjmdCue.Color or the memory-cue palette IDs.
_HOT_COLOR_CODES = {0: 49, 1: 42, 2: 33, 3: 33, 4: 20, 5: 11, 6: 1, 7: 56}
_CUE_TAGS = {b"PCOB", b"PCO2"}


class CueAnalysisSyncError(RuntimeError):
    """DB cues may be committed but downstream native analysis is not ready."""


@dataclass(frozen=True)
class NativeCue:
    slot: int
    time_ms: int
    loop_ms: int = NO_TIME
    comment: str = ""
    palette: int = -1
    active_loop: bool = False


def cues_from_rows(rows) -> list[NativeCue]:
    cues = []
    for row in rows:
        if row.Kind in (MEMORY_KIND, LEGACY_MEMORY_KIND):
            slot = 0
        elif row.Kind in KIND_TO_SLOT:
            slot = KIND_TO_SLOT[row.Kind]
        else:
            raise ValueError(f"Unsupported Rekordbox cue Kind {row.Kind}; analysis unchanged")
        time = int(row.InMsec)
        end = int(row.OutMsec) if row.OutMsec is not None and row.OutMsec >= 0 else NO_TIME
        if not 0 <= time < NO_TIME or (end != NO_TIME and not time <= end < NO_TIME):
            raise ValueError("Invalid Rekordbox cue/loop time; analysis unchanged")
        cues.append(NativeCue(slot, time, end, row.Comment or "", row.Color if row.Color is not None else -1,
                              bool(getattr(row, "ActiveLoop", False))))
    return sorted(cues, key=lambda c: (c.slot, c.time_ms, c.comment, c.palette, c.loop_ms))


def _cue_section(tag: bytes, list_type: int, cues: list[NativeCue], extended: bool) -> bytes:
    selected = [c for c in cues if bool(c.slot) == bool(list_type)]
    if tag == b"PCOB":
        # Native legacy hot-cue lists split A-C into DAT, D-H into EXT.
        selected = [c for c in selected if not c.slot or (c.slot > 3) == extended]
        entries = [CueEntry(
            hot_cue=c.slot, time_ms=c.time_ms, type=2 if c.loop_ms != NO_TIME else 1,
            loop_time_ms=c.loop_ms,
            # PCPT status 4 means active loop, NOT an enabled point cue.
            # Format reference: djl-analysis.deepsymmetry.org/.../anlz.html
            status=4 if c.active_loop and c.loop_ms != NO_TIME else 0,
            order_first=i - 1 if not c.slot and i else 0xFFFF,
            order_last=i + 1 if not c.slot and i + 1 < len(selected) else 0xFFFF,
        ) for i, c in enumerate(selected)]
        return CueListSection(list_type, entries).encode()
    entries = [CueExtendedEntry(
        hot_cue=c.slot, time_ms=c.time_ms, type=2 if c.loop_ms != NO_TIME else 1,
        loop_time_ms=c.loop_ms, comment=c.comment.rstrip("\x00") + "\x00" if c.comment else "",
        color_id=c.palette + 1 if not c.slot and c.palette in CUE_PALETTE else 0,
        color_code=_HOT_COLOR_CODES.get(c.palette, 0) if c.slot else 0,
        color_rgb=CUE_PALETTE.get(c.palette, (0, 0, 0)) if c.slot else (0, 0, 0),
    ) for c in selected]
    return CueExtendedListSection(list_type, entries).encode()


def patch_cue_sections(data: bytes, cues: list[NativeCue], *, extended: bool) -> bytes:
    """Pure byte splice: preserve header tail, section order, and non-cue bytes."""
    if len(data) < 12 or data[:4] != b"PMAI":
        raise ValueError("Not a native PMAI analysis file")
    header_len, file_len = struct.unpack_from(">II", data, 4)
    if not 12 <= header_len <= len(data) or file_len != len(data):
        raise ValueError("Invalid native ANLZ file length/header")
    offset = header_len
    sections = []
    seen = set()
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("Truncated native ANLZ section header")
        tag = data[offset:offset + 4]
        tag_header, size = struct.unpack_from(">II", data, offset + 4)
        if not 12 <= tag_header <= size or size > len(data) - offset:
            raise ValueError("Invalid native ANLZ section bounds")
        section = data[offset:offset + size]
        if tag in _CUE_TAGS:
            if size < (24 if tag == b"PCOB" else 20):
                raise ValueError("Truncated native ANLZ cue list")
            list_type = struct.unpack_from(">I", section, 12)[0]
            if list_type not in (0, 1) or (tag, list_type) in seen:
                raise ValueError("Unknown or duplicate native ANLZ cue list")
            seen.add((tag, list_type))
            section = _cue_section(tag, list_type, cues, extended)
        sections.append(section)
        offset += size
    # Some native versions omit empty cue sections; append only cue sections.
    for tag in (b"PCOB", b"PCO2") if extended else (b"PCOB",):
        for list_type in (1, 0):
            if (tag, list_type) not in seen:
                sections.append(_cue_section(tag, list_type, cues, extended))
    result = bytearray(data[:header_len] + b"".join(sections))
    struct.pack_into(">I", result, 8, len(result))
    return bytes(result)


def sync_cue_files(dat_path: Path, cues: list[NativeCue]) -> list[str]:
    """Stage both files before replacing either; report partial pair write failures.

    Caller owns the app-closed guard and backup. No files are created when either
    native DAT/EXT is absent. Per-file replacement is atomic, not pair-atomic.
    """
    paths = [Path(dat_path), Path(dat_path).with_suffix(".EXT")]
    staged = []
    updated = []
    try:
        plans = []
        for path in paths:
            if not path.is_file() or path.is_symlink():
                raise ValueError(f"Native {path.suffix} is missing or not a regular file: {path.name}")
            original = path.read_bytes()
            result = patch_cue_sections(original, cues, extended=path.suffix.upper() == ".EXT")
            if result != original:
                plans.append((path, original, result))
        for path, original, result in plans:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".manadj-cues-", delete=False) as tmp:
                staged.append((path, original, Path(tmp.name)))
                tmp.write(result)
                tmp.flush()
                os.fsync(tmp.fileno())
                os.chmod(tmp.name, stat.S_IMODE(path.stat().st_mode))
        for path, original, tmp in staged:
            if path.read_bytes() != original:
                raise RuntimeError(f"Native analysis changed during cue export: {path.name}")
            os.replace(tmp, path)
            updated.append(path.name)
        return updated
    except Exception as error:
        detail = f"; already updated: {', '.join(updated)}" if updated else ""
        raise CueAnalysisSyncError(f"Cue DB committed; native DAT/EXT not synchronized: {error}{detail}") from error
    finally:
        for _path, _original, tmp in staged:
            tmp.unlink(missing_ok=True)

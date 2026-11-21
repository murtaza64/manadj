"""On-demand, read-only USB performance data for one content-verified row.

Never imports, normalizes saved data in place or chooses a winning cue/grid.
Device analysis paths are untrusted and must stay inside the requested root.
"""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

from backend import external_drives as drives
from backend.models import Track
from backend.sync_common.matching import path_key
from rekordbox.decode_offset import export_offset_ms
from rekordbox.device.anlz_read import read_anlz

log = logging.getLogger(__name__)

MAX_ANALYSIS_BYTES = 16 * 1024 * 1024


def compare_row(session: Any, root: Path, ordinal: int, fingerprint: str) -> dict:
    preview = drives.build_pull_preview(session, root, None, verify=True)
    if preview.fingerprint != fingerprint:
        raise drives.PlanChangedError("The drive or Library changed. Recheck before comparing cues.")
    if preview.kind != "rekordbox":
        raise drives.ExternalDriveError("Cue/grid comparison currently supports Rekordbox USB only.")
    entry = next((e for e in preview.entries if e.ordinal == ordinal), None)
    if entry is None or entry.status != drives.STATUS_PRESENT or not entry.matched_path:
        raise drives.ExternalDriveError("A confirmed exact-audio match is required for aligned comparison.")
    matches = session.query(Track).filter(Track.filename == entry.matched_path).all()
    if len(matches) != 1:
        raise drives.ExternalDriveError("A unique Library audio match is required.")
    track = matches[0]
    source = drives._device_source(root, "rekordbox", entry.device_path)
    try:
        if source is None or not source.is_file() or not Path(track.filename).is_file():
            raise drives.ExternalDriveError("The confirmed audio files are no longer available.")
        # Do not inherit identity from a stale path or matching title, even for
        # the absolute-path shortcut in the general preview classifier.
        if source.stat().st_size != Path(track.filename).stat().st_size or drives._sha256(source) != drives._sha256(Path(track.filename)):
            raise drives.PlanChangedError("Audio changed since matching. Recheck before aligned comparison.")
    except OSError as exc:
        raise drives.ExternalDriveError("The confirmed audio could not be read. Recheck.") from exc
    device = drives.read_rekordbox_device(root)
    if ordinal < 0 or ordinal >= len(device.tracks):
        raise drives.PlanChangedError("The selected USB row changed. Recheck.")
    row = device.tracks[ordinal]
    if row.file_path != entry.device_path:
        raise drives.PlanChangedError("The selected USB row changed. Recheck.")
    analysis_path = row.analyze_path or ""
    if ".." in analysis_path.replace("\\", "/").split("/"):
        raise drives.ExternalDriveError("Unsafe USB analysis path.")
    dat = drives._device_rel_source(root, analysis_path)
    usb: dict = {"state": "unavailable", "reason": "USB analysis file is missing.", "cues": [], "beats": []}
    if dat is not None and dat.is_file():
        try:
            if dat.stat().st_size > MAX_ANALYSIS_BYTES:
                raise ValueError("Analysis exceeds the comparison size limit.")
            parsed = read_anlz(dat)
            if parsed.audio_path is None or path_key(parsed.audio_path) != path_key(entry.device_path):
                raise ValueError("Analysis audio path does not match this USB track.")
            analyses = [parsed]
            for suffix in (".EXT", ".2EX"):
                extra = drives._device_rel_source(root, str(Path(row.analyze_path).with_suffix(suffix)))
                if extra is None:
                    raise ValueError("Analysis variant escapes the USB root or is unreadable.")
                if extra.is_file():
                    if extra.stat().st_size > MAX_ANALYSIS_BYTES:
                        raise ValueError("Analysis exceeds the comparison size limit.")
                    item = read_anlz(extra)
                    if item.audio_path is not None and path_key(item.audio_path) != path_key(entry.device_path):
                        raise ValueError("Analysis variant names another USB track.")
                    analyses.append(item)
            if sum(len(a.cues) + len(a.cues_extended) for a in analyses) > 4096:
                raise ValueError("Too many cue entries for a bounded comparison.")
            offset = export_offset_ms(source)
            cues: dict[tuple, dict] = {}
            # Extended rows carry labels/colors. Replace only identical legacy
            # identities; retain multiple different positions in the same slot.
            for analysis in analyses:
                for cue in analysis.cues + analysis.cues_extended:
                    time = (cue.time_ms - offset) / 1000.0
                    if not math.isfinite(time):
                        continue
                    loop = cue.type == "loop" or cue.type == 2
                    key = (cue.hot_cue, cue.time_ms, cue.loop_time_ms if loop else None)
                    color = getattr(cue, "color_rgb", None)
                    item = {"slot": cue.hot_cue, "kind": "hot" if cue.hot_cue else "memory", "time": time,
                            "native_time_ms": cue.time_ms, "loop_end": (cue.loop_time_ms - offset) / 1000.0 if loop else None,
                            "label": (getattr(cue, "comment", None) or "").rstrip("\x00") or None,
                            "color": "#%02x%02x%02x" % color if color and any(color) else None}
                    if key not in cues or hasattr(cue, "comment"):
                        cues[key] = item
            usb = {"state": "read", "reason": None, "decode_offset_ms": offset,
                   "cues": sorted(cues.values(), key=lambda c: (c["time"], c["slot"])),
                   "beats": [{"time": (b.time_ms - offset) / 1000.0, "beat": b.beat_number, "bpm": b.tempo_centibpm / 100.0}
                             for b in parsed.beats[:30000]],
                   "grid_truncated": len(parsed.beats) > 30000,
                   "files": [Path(a.path).name for a in analyses]}
        except Exception as exc:  # parser variants can raise Kaitai-specific errors
            # A corrupt/unsupported analysis is unknown, never an empty cue set
            # claimed to match. No other row or source is substituted.
            log.debug("USB comparison analysis parse unavailable", exc_info=True)
            usb["reason"] = f"USB analysis could not be compared ({type(exc).__name__})."
    cues = [{"slot": c.slot_number, "kind": "hot", "time": c.time_seconds, "loop_end": None,
             "label": c.label, "color": c.color} for c in track.hotcues]
    if track.cue_point_time is not None:
        cues.append({"slot": 0, "kind": "main", "time": track.cue_point_time, "loop_end": None, "label": "Main cue", "color": None})
    grid = track.beatgrid
    try:
        segments = json.loads(grid.tempo_changes_json) if grid is not None else []
        if not isinstance(segments, list) or any(
            not isinstance(c, dict) or any(not isinstance(c.get(k), (float, int)) or not math.isfinite(c[k]) for k in ("start_time", "bpm", "bar_position"))
            or c["bpm"] <= 0 for c in segments
        ):
            segments = None
    except (ValueError, TypeError):
        segments = None
    return {"ordinal": ordinal, "track_id": track.id, "fingerprint": preview.fingerprint,
            "duration": entry.duration_secs or track.duration_secs,
            "alignment": "Exact file content; USB times use existing Rekordbox decode-offset convention",
            "newer_source": None, "read_only": True, "usb": usb,
            "library": {"cues": cues, "grid_origin": grid.origin if grid is not None else None, "tempo_changes": segments, "grid_state": "unavailable" if segments is None else "read"},
            "limits": ["Read-only. No cue or grid changes selected.", "USB memory cues and Library main cue are distinct kinds.",
                       "Loop ends are shown only when stored by USB; Library hotcues have no loop-end field."]}

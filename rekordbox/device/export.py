"""From-scratch device export: manadj playlists -> a rekordbox USB tree.

Writes the classic Device Library layout into a destination directory:

    PIONEER/rekordbox/export.pdb
    PIONEER/USBANLZ/P000/<track id>/ANLZ0000.{DAT,EXT,2EX}
    Contents/<track id>/<audio file>

Exports metadata, playlists, beatgrids, hot cues and memory mirrors, and
waveforms. Positions use the desktop decode offsets; standalone-player
offset validation remains a hardware gate. This is a rebuild, not incremental sync.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from shutil import copyfile

from mutagen import File as AudioFile
from sqlalchemy.orm import Session

from backend import models
from backend.key import Key
from backend.sync_status.models import TempoChangeValue
from rekordbox.anlz_grid import generate_beats
from rekordbox.cue_mapping import nearest_palette_index
from rekordbox.decode_offset import export_offset_ms
from rekordbox.device import anlz_write, pdb_write
from rekordbox.device.pdb_write import TABLE_TYPE, TableData, sql_string
from rekordbox.device.static_tables import COLUMNS_ROWS, MENU_ROWS, SORT_ROWS
from rekordbox.device.waveforms import build_waveforms

# pdb file_type codes (see TrackRowSpec.file_type)
FILE_TYPE_BY_CODEC = {"mp3": 1, "aac": 4, "alac": 4, "flac": 5, "pcm": 0x0B}

# rekordbox's standard color rows, exactly as every export carries them
STANDARD_COLORS = [
    (1, "Pink"),
    (2, "Red"),
    (3, "Orange"),
    (4, "Yellow"),
    (5, "Green"),
    (6, "Aqua"),
    (7, "Blue"),
    (8, "Purple"),
]

# manadj energy (1-5) -> standard color id (the desktop mapping's palette)
ENERGY_COLOR_ID = {1: 7, 2: 6, 3: 4, 4: 3, 5: 2}

# ANLZ color codes 1..62, not desktop djmdCue.Color indices (Beat Link CueList).
_HOT_COLORS = bytes.fromhex(
    "305aff 5073ff 508cff 50a0ff 50b4ff 50b0f2 50aee8 45acdb"
    "00e0ff 19daf0 32d2e6 21b4b9 20aaa0 1fa392 19a08c 14a584"
    "14aa7d 10b176 30d26e 37de5a 3ceb50 28e214 7dc13d 8cc832"
    "9bd723 a5e116 a5dc0a aad208 b4c805 b4be04 bab404 c3af04"
    "e1aa00 ffa000 ff9600 ff8c00 ff7500 e0641b e0461e e0301e"
    "e02823 e62828 ff376f ff2d6f ff127b f51e8c eb2da0 e637b4"
    "de44cf de448d e630b4 e619dc e600ff dc00ff cc00ff b432ff"
    "b93cff c542ff aa5aff aa72ff 8272ff 6473ff"
)

_FAT32_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


@dataclass
class ExportReport:
    dest: Path
    track_count: int = 0
    playlist_count: int = 0
    audio_copied: int = 0
    skipped: list[tuple[int, str]] = field(default_factory=list)  # (track_id, reason)


def _safe_name(name: str) -> str:
    return _FAT32_FORBIDDEN.sub("_", name).rstrip(". ")


def _beats_for(track: models.Track, grid: models.Beatgrid | None, offset_s: float):
    """Per-beat array in the device frame (offset-shifted), or None.

    A real grid is projected exactly (variable grids included); a track
    with only a BPM gets a constant synthesized grid anchored at 0.
    """
    import json

    duration = track.duration_secs or 0
    if not duration:
        return None
    if grid is not None and grid.origin != "generated":
        changes = [
            TempoChangeValue(
                start_time=tc["start_time"] + offset_s,
                bpm=tc["bpm"],
                bar_position=tc.get("bar_position", 1),
            )
            for tc in json.loads(grid.tempo_changes_json)
        ]
    else:
        bpm = track.bpm_projected
        if not bpm:
            return None
        changes = [TempoChangeValue(start_time=offset_s, bpm=bpm, bar_position=1)]
    beats = generate_beats(changes, duration + offset_s)
    return beats or None


def _write_analysis(
    dest: Path,
    anlz_rel: str,
    audio_device_path: str,
    beats,
    main_cue_ms: int | None,
    track: models.Track,
    offset_s: float,
) -> None:
    memory = {}
    if main_cue_ms is not None:
        memory[main_cue_ms] = anlz_write.CueExtendedEntry(hot_cue=0, time_ms=main_cue_ms)
    hot = []
    for cue in sorted(track.hotcues, key=lambda c: c.slot_number):
        time_ms = max(0, round((cue.time_seconds + offset_s) * 1000))
        palette = nearest_palette_index(cue.color)
        rgb = tuple(bytes.fromhex(cue.color.lstrip("#"))) if palette is not None else (0, 0, 0)
        code = 0
        if palette is not None:
            code = min(
                range(1, 63),
                key=lambda i: sum(
                    (a - b) ** 2 for a, b in zip(rgb, _HOT_COLORS[(i - 1) * 3 : i * 3])
                ),
            )
        entry = anlz_write.CueExtendedEntry(
            hot_cue=cue.slot_number,
            time_ms=time_ms,
            comment=(cue.label + "\x00") if cue.label else "",
            color_code=code,
            color_rgb=rgb,
        )
        hot.append(entry)
        memory[time_ms] = replace(
            entry,
            hot_cue=0,
            color_id=palette + 1 if palette is not None else 0,
            color_code=0,
            color_rgb=(0, 0, 0),
        )
    memory_extended = [memory[t] for t in sorted(memory)]
    memory_cues = [
        anlz_write.CueEntry(
            hot_cue=0,
            time_ms=c.time_ms,
            order_first=i - 1 if i else 0xFFFF,
            order_last=i + 1 if i + 1 < len(memory_extended) else 0xFFFF,
        )
        for i, c in enumerate(memory_extended)
    ]
    hot_cues = [anlz_write.CueEntry(hot_cue=c.hot_cue, time_ms=c.time_ms) for c in hot]
    blob = track.waveform.data_blob if track.waveform is not None else None
    previews, waveforms, extra = build_waveforms(track.filename, blob=blob, offset_s=offset_s)
    sections: list[anlz_write.AnlzSection] = [
        anlz_write.PathSection(path=audio_device_path),
        anlz_write.VbrSection(),
    ]
    if beats:
        # Segment boundaries can differ by microseconds but share a device
        # millisecond. The new segment owns that beat's tempo and bar phase.
        device_beats = {
            round(t * 1000): anlz_write.Beat(
                beat_number=b, tempo_centibpm=round(bpm * 100), time_ms=round(t * 1000)
            )
            for b, bpm, t in beats
            if t >= 0
        }
        sections.append(
            anlz_write.BeatGridSection(beats=[device_beats[t] for t in sorted(device_beats)])
        )
    sections.extend(previews)
    sections.append(
        anlz_write.CueListSection(list_type=1, cues=[c for c in hot_cues if c.hot_cue <= 3])
    )
    sections.append(anlz_write.CueListSection(list_type=0, cues=memory_cues))
    path = dest / anlz_rel.lstrip("/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(anlz_write.build_anlz(sections))
    path.with_suffix(".EXT").write_bytes(
        anlz_write.build_anlz(
            [
                anlz_write.PathSection(path=audio_device_path),
                waveforms[0],
                anlz_write.CueListSection(list_type=1, cues=[c for c in hot_cues if c.hot_cue > 3]),
                anlz_write.CueListSection(list_type=0, cues=memory_cues),
                anlz_write.CueExtendedListSection(list_type=1, cues=hot),
                anlz_write.CueExtendedListSection(list_type=0, cues=memory_extended),
                *waveforms[1:],
            ]
        )
    )
    path.with_suffix(".2EX").write_bytes(
        anlz_write.build_anlz([anlz_write.PathSection(path=audio_device_path), *extra])
    )


def export_playlists(
    db: Session,
    playlist_ids: list[int],
    dest: Path,
    *,
    copy_audio: bool = True,
) -> ExportReport:
    """Write a complete from-scratch device tree for the given playlists."""
    dest = Path(dest).resolve()
    report = ExportReport(dest=dest)

    playlists = [p for pid in playlist_ids if (p := db.get(models.Playlist, pid)) is not None]
    entries: dict[int, list[tuple[int, models.Track]]] = {}
    tracks: dict[int, models.Track] = {}
    for playlist in playlists:
        rows = (
            db.query(models.PlaylistTrack)
            .filter(models.PlaylistTrack.playlist_id == playlist.id)
            .order_by(models.PlaylistTrack.position)
            .all()
        )
        listed = []
        for row in rows:
            track = db.get(models.Track, row.track_id)
            if track is None or track.archived_at is not None:
                continue
            source = Path(track.filename)
            if not source.is_file():
                report.skipped.append((row.track_id, f"missing audio: {track.filename}"))
                continue
            if source.resolve().is_relative_to(dest):
                raise ValueError("export destination contains source audio")
            tracks[track.id] = track
            listed.append((row.position, track))
        entries[playlist.id] = listed

    # deduped reference tables
    artist_ids: dict[str, int] = {}
    key_ids: dict[str, int] = {}
    track_rows: list[bytes] = []

    device_paths: dict[int, tuple[str, Path]] = {}  # track id -> (device path, source)
    for track in tracks.values():
        base = _safe_name(Path(track.filename).name) or f"track-{track.id}"
        device_paths[track.id] = (f"/Contents/{track.id}/{base}", Path(track.filename))

    outputs = [dest / "PIONEER/rekordbox" / name for name in ("export.pdb", "exportExt.pdb")]
    for track_id, (device_path, _source) in device_paths.items():
        outputs.append(dest / device_path.lstrip("/"))
        outputs.extend(
            dest / f"PIONEER/USBANLZ/P000/{track_id:08X}/ANLZ0000.{suffix}"
            for suffix in ("DAT", "EXT", "2EX")
        )
    if any(not path.resolve().is_relative_to(dest) for path in outputs):
        raise ValueError("export destination contains a symlink escaping the destination")

    for track in sorted(tracks.values(), key=lambda t: t.id):
        device_path, source = device_paths[track.id]
        offset_s = export_offset_ms(source) / 1000.0

        artist_name = (track.artist or "").strip()
        if artist_name and artist_name not in artist_ids:
            artist_ids[artist_name] = len(artist_ids) + 1

        key = Key.from_engine_id(track.key)
        key_name = key.camelot if key else None
        if key_name and key_name not in key_ids:
            key_ids[key_name] = len(key_ids) + 1

        anlz_rel = f"/PIONEER/USBANLZ/P000/{track.id:08X}/ANLZ0000.DAT"
        grid = db.query(models.Beatgrid).filter(models.Beatgrid.track_id == track.id).one_or_none()
        beats = _beats_for(track, grid, offset_s)
        main_cue_ms = None
        if track.cue_point_time is not None:
            main_cue_ms = max(0, round((track.cue_point_time + offset_s) * 1000))
        _write_analysis(dest, anlz_rel, device_path, beats, main_cue_ms, track, offset_s)

        if copy_audio:
            target = dest / device_path.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            copyfile(source, target)
            report.audio_copied += 1

        bpm = track.bpm_projected
        strings = [sql_string("") for _ in range(21)]
        strings[7] = sql_string("ON")
        strings[10] = sql_string((track.created_at or datetime.now(UTC)).date().isoformat())
        strings[14] = sql_string(anlz_rel)
        strings[15] = sql_string(datetime.now(UTC).date().isoformat())
        strings[17] = sql_string(track.title or Path(track.filename).stem)
        strings[19] = sql_string(Path(device_path).name)
        strings[20] = sql_string(device_path)
        audio = AudioFile(source)
        spec = pdb_write.TrackRowSpec(
            id=track.id,
            strings=strings,
            artist_id=artist_ids.get(artist_name, 0),
            key_id=key_ids.get(key_name or "", 0),
            tempo_centibpm=round(bpm * 100) if bpm else 0,
            duration_secs=int(track.duration_secs or 0),
            file_size=source.stat().st_size,
            bitrate=track.bitrate_kbps or 0,
            file_type=FILE_TYPE_BY_CODEC.get(track.codec or "", 4),
            sample_rate=audio.info.sample_rate if audio is not None else 44100,
            color_id=ENERGY_COLOR_ID.get(track.energy or 0, 0),
        )
        track_rows.append(pdb_write.encode_track_row(pdb_write.pad_track_row(spec)))
        report.track_count += 1

    playlist_rows = []
    entry_rows = []
    for sort_order, playlist in enumerate(playlists, start=1):
        playlist_rows.append(
            pdb_write.PlaylistTreeRowSpec(
                id=playlist.id,
                name=sql_string(playlist.name),
                sort_order=sort_order,
            ).encode()
        )
        for i, (_pos, track) in enumerate(entries[playlist.id], start=1):
            entry_rows.append(
                pdb_write.PlaylistEntryRowSpec(
                    entry_index=i, track_id=track.id, playlist_id=playlist.id
                ).encode()
            )
        report.playlist_count += 1

    tables = {
        "tracks": track_rows,
        "artists": [
            pdb_write.ArtistRowSpec(id=aid, name=sql_string(name)).encode()
            for name, aid in artist_ids.items()
        ],
        "keys": [
            pdb_write.KeyRowSpec(id=kid, name=sql_string(name)).encode()
            for name, kid in key_ids.items()
        ],
        "colors": [
            pdb_write.ColorRowSpec(id=cid, name=sql_string(name)).encode()
            for cid, name in STANDARD_COLORS
        ],
        "playlist_tree": playlist_rows,
        "playlist_entries": entry_rows,
        "columns": COLUMNS_ROWS,
    }
    rows_by_type = {TABLE_TYPE[name]: rows for name, rows in tables.items()}
    rows_by_type[17] = MENU_ROWS
    rows_by_type[18] = SORT_ROWS
    table_data = [TableData(t, rows_by_type.get(t, [])) for t in range(20)]
    pdb_path = dest / "PIONEER" / "rekordbox" / "export.pdb"
    pdb_path.parent.mkdir(parents=True, exist_ok=True)
    pdb_path.write_bytes(pdb_write.build_pdb(table_data))
    pdb_path.with_name("exportExt.pdb").write_bytes(
        pdb_write.build_pdb([TableData(t) for t in range(9)])
    )
    return report

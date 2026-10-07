"""From-scratch device export: manadj playlists -> a rekordbox USB tree.

Writes the classic Device Library layout into a destination directory:

    PIONEER/rekordbox/export.pdb
    PIONEER/USBANLZ/P000/<track id>/ANLZ0000.DAT
    Contents/<audio files>

Tracer scope (rekordbox-usb-export/04): playable minimum — track metadata,
playlists, beatgrid (PQTZ), main cue (PCOB), placeholder-but-valid waveform
previews. Cue and grid positions are decode-offset corrected per container
class (the desktop-export offsets; device-side validity is a CDJ-3000
session question). Real waveforms, hot cues, and sync are later issues.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from shutil import copyfile

from sqlalchemy.orm import Session

from backend import models
from backend.key import Key
from backend.sync_status.models import TempoChangeValue
from rekordbox.anlz_grid import generate_beats
from rekordbox.decode_offset import export_offset_ms
from rekordbox.device import anlz_write, pdb_write
from rekordbox.device.pdb_write import TABLE_TYPE, TableData, sql_string

# pdb file_type codes (see TrackRowSpec.file_type)
FILE_TYPE_BY_CODEC = {"mp3": 1, "aac": 4, "alac": 4, "flac": 5, "pcm": 0x0B}

# rekordbox's standard color rows, exactly as every export carries them
STANDARD_COLORS = [
    (1, "Pink"), (2, "Red"), (3, "Orange"), (4, "Yellow"),
    (5, "Green"), (6, "Aqua"), (7, "Blue"), (8, "Purple"),
]

# manadj energy (1-5) -> standard color id (the desktop mapping's palette)
ENERGY_COLOR_ID = {1: 7, 2: 6, 3: 4, 4: 3, 5: 2}

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


def _placeholder_previews() -> list[anlz_write.AnlzSection]:
    # 5-bit height 10 + whiteness 1 for PWAV; 4-bit height 5 for PWV2.
    # Valid sizes, visibly flat; real waveforms are issue 05.
    return [
        anlz_write.WavePreviewSection(fourcc=b"PWAV", data=bytes([(1 << 5) | 10] * 400)),
        anlz_write.WavePreviewSection(fourcc=b"PWV2", data=bytes([5] * 100)),
    ]


def _write_anlz_dat(
    dest: Path,
    anlz_rel: str,
    audio_device_path: str,
    beats,
    main_cue_ms: int | None,
) -> None:
    memory_cues = []
    if main_cue_ms is not None:
        memory_cues.append(anlz_write.CueEntry(hot_cue=0, time_ms=main_cue_ms))
    sections: list[anlz_write.AnlzSection] = [
        anlz_write.PathSection(path=audio_device_path),
        anlz_write.VbrSection(),
    ]
    if beats:
        sections.append(
            anlz_write.BeatGridSection(
                beats=[
                    anlz_write.Beat(
                        beat_number=b,
                        tempo_centibpm=round(bpm * 100),
                        time_ms=round(t * 1000),
                    )
                    for b, bpm, t in beats
                ]
            )
        )
    sections.extend(_placeholder_previews())
    sections.append(
        anlz_write.CueListSection(
            list_type=0, cues=memory_cues, memory_count=len(memory_cues)
        )
    )
    sections.append(anlz_write.CueListSection(list_type=1))
    path = dest / anlz_rel.lstrip("/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(anlz_write.build_anlz(sections))


def export_playlists(
    db: Session,
    playlist_ids: list[int],
    dest: Path,
    *,
    copy_audio: bool = True,
) -> ExportReport:
    """Write a complete from-scratch device tree for the given playlists."""
    dest = Path(dest)
    report = ExportReport(dest=dest)

    playlists = [
        p for pid in playlist_ids if (p := db.get(models.Playlist, pid)) is not None
    ]
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
            tracks[track.id] = track
            listed.append((row.position, track))
        entries[playlist.id] = listed

    # deduped reference tables
    artist_ids: dict[str, int] = {}
    key_ids: dict[str, int] = {}
    track_rows: list[bytes] = []

    used_names: set[str] = set()
    device_paths: dict[int, tuple[str, Path]] = {}  # track id -> (device path, source)
    for track in tracks.values():
        base = _safe_name(Path(track.filename).name) or f"track-{track.id}"
        name = base
        while name in used_names:
            name = f"{track.id}-{base}"
        used_names.add(name)
        device_paths[track.id] = (f"/Contents/{name}", Path(track.filename))

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
        grid = (
            db.query(models.Beatgrid)
            .filter(models.Beatgrid.track_id == track.id)
            .one_or_none()
        )
        beats = _beats_for(track, grid, offset_s)
        main_cue_ms = None
        if track.cue_point_time is not None:
            main_cue_ms = max(0, round((track.cue_point_time + offset_s) * 1000))
        _write_anlz_dat(dest, anlz_rel, device_path, beats, main_cue_ms)

        if copy_audio:
            target = dest / device_path.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            copyfile(source, target)
            report.audio_copied += 1

        bpm = track.bpm_projected
        strings = [sql_string("") for _ in range(21)]
        strings[14] = sql_string(anlz_rel)
        strings[17] = sql_string(track.title or Path(track.filename).stem)
        strings[19] = sql_string(Path(device_path).name)
        strings[20] = sql_string(device_path)
        spec = pdb_write.TrackRowSpec(
            id=track.id,
            strings=strings,
            artist_id=artist_ids.get(artist_name, 0),
            key_id=key_ids.get(key_name or "", 0),
            tempo_centibpm=round(bpm * 100) if bpm else 0,
            duration_secs=int(track.duration_secs or 0),
            file_size=track.filesize_bytes or source.stat().st_size,
            bitrate=track.bitrate_kbps or 0,
            file_type=FILE_TYPE_BY_CODEC.get(track.codec or "", 4),
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
    }
    rows_by_type = {TABLE_TYPE[name]: rows for name, rows in tables.items()}
    table_data = [TableData(t, rows_by_type.get(t, [])) for t in range(20)]
    pdb_path = dest / "PIONEER" / "rekordbox" / "export.pdb"
    pdb_path.parent.mkdir(parents=True, exist_ok=True)
    pdb_path.write_bytes(pdb_write.build_pdb(table_data))
    return report

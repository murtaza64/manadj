"""Typed read layer over the Kaitai-generated export.pdb parser.

Walks every table's page chain, honors row-presence bitmasks (rows whose
presence bit is 0 are deleted and may be malformed — never parsed), and
decodes DeviceSQL strings, converting rows into plain dataclasses that
serialize cleanly to JSON.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kaitaistruct import BytesIO, KaitaiStream

from rekordbox.device.generated.rekordbox_pdb import RekordboxPdb


def _text(device_sql_string: Any) -> str | None:
    """Decode a DeviceSqlString defensively.

    Real exports contain occasional strings the spec models loosely (e.g.
    the ISRC quirk: kind 0x90 holding ASCII, not UTF-16LE). A read layer
    should surface the rest of the row rather than die on one field.
    """
    if device_sql_string is None:
        return None
    try:
        return device_sql_string.body.text
    except Exception:  # noqa: BLE001 — malformed string must not kill the row
        return None


@dataclass
class PdbTrack:
    id: int
    title: str | None
    artist_id: int
    album_id: int
    genre_id: int
    key_id: int
    label_id: int
    original_artist_id: int
    remixer_id: int
    composer_id: int
    artwork_id: int
    color_id: int
    rating: int
    tempo_centibpm: int
    duration_secs: int
    sample_rate: int
    sample_depth: int
    bitrate: int
    file_size: int
    track_number: int
    disc_number: int
    play_count: int
    year: int
    file_type: int  # MP3=1, M4A/AAC=4, FLAC=5, WAV=0x0b, AIFF=0x0c
    file_path: str | None
    filename: str | None
    analyze_path: str | None
    analyze_date: str | None
    date_added: str | None
    release_date: str | None
    mix_name: str | None
    comment: str | None
    isrc: str | None
    kuvo_public: str | None
    autoload_hot_cues: str | None


@dataclass
class PdbNamedRow:
    id: int
    name: str | None


@dataclass
class PdbAlbum:
    id: int
    name: str | None
    artist_id: int


@dataclass
class PdbKey:
    id: int
    id2: int
    name: str | None


@dataclass
class PdbArtwork:
    id: int
    path: str | None


@dataclass
class PdbPlaylistNode:
    id: int
    parent_id: int
    sort_order: int
    is_folder: bool
    name: str | None


@dataclass
class PdbPlaylistEntry:
    playlist_id: int
    track_id: int
    entry_index: int


@dataclass
class PdbTag:
    id: int
    name: str | None
    is_category: bool
    category: int
    category_pos: int


@dataclass
class PdbTagTrack:
    track_id: int
    tag_id: int


@dataclass
class PdbTable:
    name: str
    raw_type: int
    row_count: int
    rows: list[Any] = field(default_factory=list)


@dataclass
class PdbFile:
    path: str
    is_ext: bool
    len_page: int
    num_tables: int
    sequence: int
    tables: dict[str, PdbTable] = field(default_factory=dict)


def _track(row: Any) -> PdbTrack:
    return PdbTrack(
        id=row.id,
        title=_text(row.title),
        artist_id=row.artist_id,
        album_id=row.album_id,
        genre_id=row.genre_id,
        key_id=row.key_id,
        label_id=row.label_id,
        original_artist_id=row.original_artist_id,
        remixer_id=row.remixer_id,
        composer_id=row.composer_id,
        artwork_id=row.artwork_id,
        color_id=row.color_id,
        rating=row.rating,
        tempo_centibpm=row.tempo,
        duration_secs=row.duration,
        sample_rate=row.sample_rate,
        sample_depth=row.sample_depth,
        bitrate=row.bitrate,
        file_size=row.file_size,
        track_number=row.track_number,
        disc_number=row.disc_number,
        play_count=row.play_count,
        year=row.year,
        file_type=row._unnamed29,
        file_path=_text(row.file_path),
        filename=_text(row.filename),
        analyze_path=_text(row.analyze_path),
        analyze_date=_text(row.analyze_date),
        date_added=_text(row.date_added),
        release_date=_text(row.release_date),
        mix_name=_text(row.mix_name),
        comment=_text(row.comment),
        isrc=_text(row.isrc),
        kuvo_public=_text(row.kuvo_public),
        autoload_hot_cues=_text(row.autoload_hot_cues),
    )


def _named(row: Any) -> PdbNamedRow:
    return PdbNamedRow(id=row.id, name=_text(row.name))


def _color(row: Any) -> PdbNamedRow:
    return PdbNamedRow(id=row.id, name=_text(row.name))


def _album(row: Any) -> PdbAlbum:
    return PdbAlbum(id=row.id, name=_text(row.name), artist_id=row.artist_id)


def _key(row: Any) -> PdbKey:
    return PdbKey(id=row.id, id2=row.id2, name=_text(row.name))


def _artwork(row: Any) -> PdbArtwork:
    return PdbArtwork(id=row.id, path=_text(row.path))


def _playlist_tree(row: Any) -> PdbPlaylistNode:
    return PdbPlaylistNode(
        id=row.id,
        parent_id=row.parent_id,
        sort_order=row.sort_order,
        is_folder=row.is_folder,
        name=_text(row.name),
    )


def _playlist_entry(row: Any) -> PdbPlaylistEntry:
    return PdbPlaylistEntry(
        playlist_id=row.playlist_id,
        track_id=row.track_id,
        entry_index=row.entry_index,
    )


def _history_playlist(row: Any) -> PdbNamedRow:
    return PdbNamedRow(id=row.id, name=_text(row.name))


def _history_entry(row: Any) -> PdbPlaylistEntry:
    return PdbPlaylistEntry(
        playlist_id=row.playlist_id,
        track_id=row.track_id,
        entry_index=row.entry_index,
    )


def _tag(row: Any) -> PdbTag:
    return PdbTag(
        id=row.id,
        name=_text(row.name),
        is_category=row.is_category,
        category=row.category,
        category_pos=row.category_pos,
    )


def _tag_track(row: Any) -> PdbTagTrack:
    return PdbTagTrack(track_id=row.track_id, tag_id=row.tag_id)


_CONVERTERS: dict[str, Callable[[Any], Any]] = {
    "tracks": _track,
    "artists": _named,
    "albums": _album,
    "genres": _named,
    "keys": _key,
    "labels": _named,
    "colors": _color,
    "artwork": _artwork,
    "playlist_tree": _playlist_tree,
    "playlist_entries": _playlist_entry,
    "history_playlists": _history_playlist,
    "history_entries": _history_entry,
    "tags": _tag,
    "tag_tracks": _tag_track,
}


def _table_type(table: Any, is_ext: bool) -> tuple[str, int]:
    raw = table.type_ext if is_ext else table.type
    if hasattr(raw, "name"):
        return raw.name, int(raw)
    return f"unknown_0x{int(raw):02x}", int(raw)


def _iter_present_rows(table: Any, is_ext: bool) -> Iterator[Any]:
    """Walk the table's page chain, yielding present row bodies.

    Follows `next_page` links from `first_page`, stopping after `last_page`.
    Non-data pages (index pages, flag 0x40) carry no rows. Rows whose
    presence bit is unset are skipped without parsing.
    """
    last_index = table.last_page.index
    page_ref = table.first_page
    seen: set[int] = set()
    while True:
        page_index = page_ref.index
        if page_index in seen:  # corrupt chain; refuse to loop forever
            return
        seen.add(page_index)
        page = page_ref.body
        if page.is_data_page:
            for group in page.row_groups or []:
                for row_ref in group.rows:
                    if not row_ref.present:
                        continue
                    body = row_ref.body_ext if is_ext else row_ref.body
                    if body is not None:
                        yield body
        if page_index == last_index:
            return
        page_ref = page.next_page


def read_pdb(path: str | Path, ext: bool | None = None) -> PdbFile:
    """Parse an export.pdb / exportExt.pdb into typed tables.

    `ext` selects the exportExt.pdb schema; by default it is inferred from
    the filename.
    """
    path = Path(path)
    if ext is None:
        ext = "ext" in path.name.lower()
    data = path.read_bytes()
    root = RekordboxPdb(ext, KaitaiStream(BytesIO(data)))

    tables: dict[str, PdbTable] = {}
    for table in root.tables:
        name, raw_type = _table_type(table, ext)
        convert = _CONVERTERS.get(name)
        rows: list[Any] = []
        count = 0
        for body in _iter_present_rows(table, ext):
            count += 1
            if convert is not None:
                rows.append(convert(body))
        tables[name] = PdbTable(name=name, raw_type=raw_type, row_count=count, rows=rows)

    return PdbFile(
        path=str(path),
        is_ext=ext,
        len_page=root.len_page,
        num_tables=root.num_tables,
        sequence=root.sequence,
        tables=tables,
    )

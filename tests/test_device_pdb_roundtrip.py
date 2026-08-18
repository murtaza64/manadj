"""Corpus-gated byte round-trip: export.pdb -> parse -> re-encode -> identical.

Every present row and every page header of a real rekordbox export is
re-encoded from parsed fields via the writer (rekordbox/device/pdb_write)
and written back over a copy of the original file; the result must be
byte-identical. Deleted rows, index-page heaps, and unallocated pages are
un-reverse-engineered and preserved verbatim — everything rekordbox
meaningfully wrote is re-derived.

The kaitai-generated reader is used only as the parsing oracle; adapters
here bridge parsed objects to writer specs (the writer itself never touches
the reader).
"""

import os
import struct
from pathlib import Path

import pytest
from kaitaistruct import BytesIO, KaitaiStream

from rekordbox.device.generated.rekordbox_pdb import RekordboxPdb
from rekordbox.device.pdb_write import (
    PAGE_HEADER_LEN,
    AlbumRowSpec,
    ArtistRowSpec,
    ArtworkRowSpec,
    ColorRowSpec,
    HistoryEntryRowSpec,
    IdNameRowSpec,
    KeyRowSpec,
    LongAscii,
    LongUtf16,
    PageHeaderSpec,
    PlaylistEntryRowSpec,
    PlaylistTreeRowSpec,
    RawString,
    ShortAscii,
    SqlString,
    TagRowSpec,
    TagTrackRowSpec,
    TrackRowSpec,
    encode_track_row,
)

# Tables whose row format is not reverse-engineered anywhere; their rows are
# preserved verbatim rather than re-encoded.
UNADAPTED_OK = {"columns", "unknown_17", "unknown_18", "history"}

_CORPUS = os.environ.get("MANADJ_RB_EXPORT_CORPUS")

pytestmark = pytest.mark.skipif(not _CORPUS, reason="MANADJ_RB_EXPORT_CORPUS not set")


def _roots() -> list[Path]:
    if not _CORPUS:
        return []
    base = Path(_CORPUS)
    if (base / "PIONEER").is_dir():
        return [base]
    return sorted(p for p in base.iterdir() if (p / "PIONEER").is_dir())


# --- string adapter ----------------------------------------------------------


def string_at(data: bytes, pos: int) -> tuple[SqlString, bytes]:
    """Read the raw DeviceSQL string at pos; return (spec, raw bytes).

    Falls back to RawString when the standard encodings do not reproduce
    the bytes (e.g. the ISRC quirk: kind 0x90 wrapping 0x03+ASCII+NUL).
    """
    kind = data[pos]
    if kind & 1:
        total = kind >> 1
        raw = data[pos : pos + max(total, 1)]
        spec: SqlString = ShortAscii(raw[1:].decode("ascii", errors="replace"))
    else:
        length = struct.unpack_from("<H", data, pos + 1)[0]
        raw = data[pos : pos + length]
        if kind == 0x90:
            spec = LongUtf16(raw[4:].decode("utf-16-le", errors="replace"))
        elif kind == 0x40:
            spec = LongAscii(raw[4:].decode("ascii", errors="replace"))
        else:
            return RawString(raw), raw
    if spec.encode() != raw:
        return RawString(raw), raw
    return spec, raw


# --- row adapters: kaitai row -> (spec, expected heap extent) ----------------


def adapt_track(row, data: bytes, base: int, stats) -> list[tuple[int, bytes]]:
    strings = []
    for ofs in row.ofs_strings:
        spec, _raw = string_at(data, base + ofs)
        if isinstance(spec, RawString):
            stats["raw_strings"] += 1
        strings.append(spec)
    spec = TrackRowSpec(
        id=row.id,
        strings=strings,
        subtype=row.subtype,
        index_shift=row.index_shift,
        bitmask=row.bitmask,
        sample_rate=row.sample_rate,
        composer_id=row.composer_id,
        file_size=row.file_size,
        unknown6=row._unnamed6,
        unknown7=row._unnamed7,
        unknown8=row._unnamed8,
        artwork_id=row.artwork_id,
        key_id=row.key_id,
        original_artist_id=row.original_artist_id,
        label_id=row.label_id,
        remixer_id=row.remixer_id,
        bitrate=row.bitrate,
        track_number=row.track_number,
        tempo_centibpm=row.tempo,
        genre_id=row.genre_id,
        album_id=row.album_id,
        artist_id=row.artist_id,
        disc_number=row.disc_number,
        play_count=row.play_count,
        year=row.year,
        sample_depth=row.sample_depth,
        duration_secs=row.duration,
        unknown26=row._unnamed26,
        color_id=row.color_id,
        rating=row.rating,
        unknown29=row._unnamed29,
        unknown30=row._unnamed30,
    )
    return [(0, encode_track_row(spec))]


def adapt_artist(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + (row.ofs_name_far if row.subtype & 4 else row.ofs_name_near))
    spec = ArtistRowSpec(
        id=row.id, name=name, subtype=row.subtype, index_shift=row.index_shift,
        unknown3=row._unnamed3,
    )
    return [(0, spec.encode())]


def adapt_album(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + (row.ofs_name_far if row.subtype & 4 else row.ofs_name_near))
    spec = AlbumRowSpec(
        id=row.id, name=name, artist_id=row.artist_id, subtype=row.subtype,
        index_shift=row.index_shift, unknown2=row._unnamed2, unknown5=row._unnamed5,
        unknown6=row._unnamed6,
    )
    return [(0, spec.encode())]


def adapt_id_name(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + 4)
    return [(0, IdNameRowSpec(id=row.id, name=name).encode())]


def adapt_key(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + 8)
    return [(0, KeyRowSpec(id=row.id, name=name, id2=row.id2).encode())]


def adapt_color(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + 8)
    spec = ColorRowSpec(
        id=row.id, name=name, unknown0=row._unnamed0, unknown2=row._unnamed2
    )
    return [(0, spec.encode())]


def adapt_artwork(row, data: bytes, base: int, stats):
    path, _ = string_at(data, base + 4)
    return [(0, ArtworkRowSpec(id=row.id, path=path).encode())]


def adapt_playlist_tree(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + 20)
    spec = PlaylistTreeRowSpec(
        id=row.id, name=name, parent_id=row.parent_id, sort_order=row.sort_order,
        is_folder=row.is_folder, unknown1=struct.unpack_from("<I", data, base + 4)[0],
    )
    return [(0, spec.encode())]


def adapt_playlist_entry(row, data: bytes, base: int, stats):
    spec = PlaylistEntryRowSpec(
        entry_index=row.entry_index, track_id=row.track_id, playlist_id=row.playlist_id
    )
    return [(0, spec.encode())]


def adapt_history_playlist(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + 4)
    return [(0, IdNameRowSpec(id=row.id, name=name).encode())]


def adapt_history_entry(row, data: bytes, base: int, stats):
    spec = HistoryEntryRowSpec(
        track_id=row.track_id, playlist_id=row.playlist_id, entry_index=row.entry_index
    )
    return [(0, spec.encode())]


def adapt_tag(row, data: bytes, base: int, stats):
    name, _ = string_at(data, base + row.ofs_name_near)
    spec = TagRowSpec(
        id=row.id, name=name, tag_index=row.tag_index, category=row.category,
        category_pos=row.category_pos, raw_is_category=row.raw_is_category,
        subtype=row.subtype, unknown2=row._unnamed2, unknown7=row._unnamed7,
    )
    header = spec.encode_header(row.ofs_name_near, row.ofs_unknown_near)
    return [(0, header), (row.ofs_name_near, name.encode())]


def adapt_tag_track(row, data: bytes, base: int, stats):
    spec = TagTrackRowSpec(
        track_id=row.track_id, tag_id=row.tag_id,
        unknown0=row._unnamed0, unknown3=row._unnamed3,
    )
    return [(0, spec.encode())]


ADAPTERS = {
    "tracks": adapt_track,
    "tags": adapt_tag,
    "tag_tracks": adapt_tag_track,
    "artists": adapt_artist,
    "albums": adapt_album,
    "genres": adapt_id_name,
    "labels": adapt_id_name,
    "keys": adapt_key,
    "colors": adapt_color,
    "artwork": adapt_artwork,
    "playlist_tree": adapt_playlist_tree,
    "playlist_entries": adapt_playlist_entry,
    "history_playlists": adapt_history_playlist,
    "history_entries": adapt_history_entry,
}


# --- reassembly ---------------------------------------------------------------


def walk_pages(table):
    ref = table.first_page
    seen = set()
    while True:
        page = ref.body
        yield ref.index, page
        if ref.index == table.last_page.index or ref.index in seen:
            return
        seen.add(ref.index)
        ref = page.next_page


def reassemble(data: bytes, is_ext: bool, stats) -> bytes:
    root = RekordboxPdb(is_ext, KaitaiStream(BytesIO(data)))
    len_page = root.len_page
    out = bytearray(data)

    # file header: fixed fields + table pointers re-encoded, tail verbatim
    head = struct.pack(
        "<IIIIII", 0, root.len_page, root.num_tables, root.next_unused_page,
        root._unnamed4, root.sequence,
    ) + b"\x00" * 4
    for t in root.tables:
        raw_type = int(t.type_ext if is_ext else t.type)
        head += struct.pack(
            "<IIII", raw_type, t.empty_candidate, t.first_page.index, t.last_page.index
        )
    out[: len(head)] = head

    for t in root.tables:
        name = getattr(t.type_ext if is_ext else t.type, "name", None)
        adapter = ADAPTERS.get(name or "")
        for page_index, page in walk_pages(t):
            page_off = page_index * len_page
            header = PageHeaderSpec(
                page_index=page.page_index,
                page_type=int(page.type_ext if is_ext else page.type),
                next_page=page.next_page.index,
                sequence=page.sequence,
                unknown6=page._unnamed6,
                num_row_offsets=page.num_row_offsets,
                num_rows=page.num_rows,
                page_flags=page.page_flags,
                free_size=page.free_size,
                used_size=page.used_size,
                transaction_row_count=page.transaction_row_count,
                transaction_row_index=page.transaction_row_index,
                unknown14=page._unnamed14,
                unknown15=page._unnamed15,
            )
            out[page_off : page_off + PAGE_HEADER_LEN] = header.encode()
            stats["pages"] += 1
            if not page.is_data_page:
                continue
            for group in page.row_groups or []:
                gbase = page_off + len_page - group.group_index * 36
                struct.pack_into("<H", out, gbase - 4, group.row_present_flags)
                for row_ref in group.rows:
                    if not row_ref.present:
                        continue
                    struct.pack_into(
                        "<H", out, gbase - (6 + 2 * row_ref.row_index), row_ref.ofs_row
                    )
                    body = row_ref.body_ext if is_ext else row_ref.body
                    if body is None or adapter is None:
                        stats.setdefault("unadapted", {}).setdefault(name or "?", 0)
                        stats["unadapted"][name or "?"] += 1
                        continue
                    row_base = page_off + PAGE_HEADER_LEN + row_ref.ofs_row
                    for rel, blob in adapter(body, data, row_base, stats):
                        out[row_base + rel : row_base + rel + len(blob)] = blob
                    stats["rows"] += 1
    return bytes(out)


def first_diff(a: bytes, b: bytes) -> int | None:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    if len(a) != len(b):
        return min(len(a), len(b))
    return None


@pytest.fixture(params=_roots(), ids=lambda p: p.name)
def export_root(request) -> Path:
    return request.param


def test_export_pdb_roundtrips_byte_identical(export_root):
    data = (export_root / "PIONEER" / "rekordbox" / "export.pdb").read_bytes()
    stats = {"pages": 0, "rows": 0, "raw_strings": 0}
    out = reassemble(data, is_ext=False, stats=stats)
    diff = first_diff(data, out)
    assert diff is None, (
        f"first diff at {diff} (page {diff // 4096}, offset {diff % 4096:#x}); stats={stats}"
    )
    assert stats["rows"] > 500
    assert set(stats.get("unadapted", {})) <= UNADAPTED_OK
    # Raw fallbacks should be rare quirks (ISRC-style), not a coverage hole.
    assert stats["raw_strings"] <= stats["rows"] // 4


def test_export_ext_pdb_roundtrips_byte_identical(export_root):
    path = export_root / "PIONEER" / "rekordbox" / "exportExt.pdb"
    if not path.is_file():
        pytest.skip("no exportExt.pdb in this export")
    data = path.read_bytes()
    stats = {"pages": 0, "rows": 0, "raw_strings": 0}
    out = reassemble(data, is_ext=True, stats=stats)
    diff = first_diff(data, out)
    assert diff is None, (
        f"first diff at {diff} (page {diff // 4096}, offset {diff % 4096:#x}); stats={stats}"
    )
    assert stats["rows"] > 0
    # ext unknown_* tables have no reverse-engineered row format; verbatim
    assert all(k.startswith("unknown_") for k in stats.get("unadapted", {}))

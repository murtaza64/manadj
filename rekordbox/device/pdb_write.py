"""DeviceSQL (export.pdb / exportExt.pdb) serializer.

Two layers:

- Encoders: DeviceSQL strings, row bodies, page headers, row indexes —
  byte-exact against rekordbox's own output (proven by the corpus-gated
  round-trip tests, which re-encode every present row of a real export and
  require the reassembled file to be byte-identical).
- From-scratch builders: pages and whole database files for the device
  exporter, including the index-page free-space structure required by
  desktop Rekordbox (not inspected by the row-reading oracle).

Hardware pitfalls honored (learned the hard way by the rekordcrate work):
track rows are padded to a minimum size via the comment string (short rows
crash CDJs entering the track menu), UTF-16LE strings are length-prefixed
exactly, row padding never overwrites row data, rating is a raw byte 0-5.

This module must not import the read layer or the generated parsers: the
reader is the independent oracle for this writer.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

PAGE_LEN = 4096
PAGE_HEADER_LEN = 0x28
ROW_GROUP_BYTES = 36  # 16 u2 offsets + row-presence u2 + transaction u2
INDEX_PAGE_FLAGS = 0x64
DATA_PAGE_FLAGS = 0x24
INDEX_PAGE_MAGIC = 0x03EC  # observed on every index page rekordbox writes

# The CDJ-350 crashed on track rows shorter than ~221 bytes (rekordcrate
# PR #259); pad the comment string until the encoded row clears this.
MIN_TRACK_ROW_LEN = 221


# --- DeviceSQL strings -------------------------------------------------------


@dataclass(frozen=True)
class ShortAscii:
    text: str

    def encode(self) -> bytes:
        data = self.text.encode("ascii")
        length = len(data) + 1
        if length > 0x7F:
            raise ValueError(f"short ascii too long ({len(data)} bytes)")
        return struct.pack("<B", (length << 1) | 1) + data


@dataclass(frozen=True)
class LongUtf16:
    text: str

    def encode(self) -> bytes:
        data = self.text.encode("utf-16-le")
        return struct.pack("<BHB", 0x90, len(data) + 4, 0) + data


@dataclass(frozen=True)
class LongAscii:
    text: str

    def encode(self) -> bytes:
        data = self.text.encode("ascii")
        return struct.pack("<BHB", 0x40, len(data) + 4, 0) + data


@dataclass(frozen=True)
class RawString:
    """Verbatim passthrough for quirk forms (e.g. the ISRC 0x03-prefixed
    kind-0x90 string) so round-trips stay byte-exact."""

    data: bytes

    def encode(self) -> bytes:
        return self.data


SqlString = ShortAscii | LongUtf16 | LongAscii | RawString


def _needs_alignment(spec: SqlString, encoded: bytes) -> bool:
    """Long-form strings (kinds 0x90 UTF-16LE and 0x40 long-ASCII) are
    4-byte aligned in the heap — misaligned UCS2 crashes CDJs (the
    rekordcrate #234 pitfall); confirmed against rekordbox's own output,
    which pads exactly these and nothing else."""
    if isinstance(spec, (LongUtf16, LongAscii)):
        return True
    return len(encoded) > 0 and encoded[0] in (0x40, 0x90)


def _aligned_ofs(base: int, spec: SqlString, encoded: bytes) -> int:
    """Row-relative offset for a name string that follows a fixed header of
    `base` bytes, honoring the 0x90 alignment rule (row starts are 4-byte
    aligned in the page, so row-relative alignment is absolute)."""
    if _needs_alignment(spec, encoded) and base % 4:
        return base + (4 - base % 4)
    return base


def sql_string(text: str) -> SqlString:
    """Encoding policy for from-scratch writing, matching rekordbox: short
    ASCII when it fits, long ASCII for oversize ASCII, UTF-16LE otherwise."""
    try:
        encoded = text.encode("ascii")
    except UnicodeEncodeError:
        return LongUtf16(text)
    if len(encoded) + 1 <= 0x7F:
        return ShortAscii(text)
    return LongAscii(text)


# --- row specs + encoders ----------------------------------------------------


@dataclass
class TrackRowSpec:
    id: int
    strings: list[SqlString]  # exactly 21, device string slot order
    subtype: int = 0x24
    index_shift: int = 0
    bitmask: int = 0x000C0700
    sample_rate: int = 44100
    composer_id: int = 0
    file_size: int = 0
    unknown6: int = 0
    unknown7: int = 58638
    unknown8: int = 2843
    artwork_id: int = 0
    key_id: int = 0
    original_artist_id: int = 0
    label_id: int = 0
    remixer_id: int = 0
    bitrate: int = 0
    track_number: int = 0
    tempo_centibpm: int = 0
    genre_id: int = 0
    album_id: int = 0
    artist_id: int = 0
    disc_number: int = 0
    play_count: int = 0
    year: int = 0
    sample_depth: int = 16
    duration_secs: int = 0
    unknown26: int = 41
    color_id: int = 0
    rating: int = 0
    # crate-digger leaves this unnamed, but the corpus distribution matches
    # codecs exactly: MP3=1, M4A/AAC=4, FLAC=5, WAV=0x0b (AIFF=0x0c)
    file_type: int = 4
    unknown30: int = 3

    def __post_init__(self) -> None:
        if len(self.strings) != 21:
            raise ValueError(f"track row needs 21 strings, got {len(self.strings)}")
        if not 0 <= self.rating <= 5:
            raise ValueError(f"rating is a raw byte 0-5, got {self.rating}")


TRACK_FIXED_LEN = 94 + 21 * 2  # fixed fields + string offset table


def encode_track_row(spec: TrackRowSpec) -> bytes:
    heap = bytearray()
    offsets: list[int] = []
    pos = TRACK_FIXED_LEN
    for string in spec.strings:
        blob = string.encode()
        if _needs_alignment(string, blob) and pos % 4:
            pad = 4 - pos % 4
            heap += b"\x00" * pad
            pos += pad
        offsets.append(pos)
        heap += blob
        pos += len(blob)
    fixed = struct.pack(
        "<HHIIIIIHHIIIIIIIIIIIIHHHHHHBBHH",
        spec.subtype,
        spec.index_shift,
        spec.bitmask,
        spec.sample_rate,
        spec.composer_id,
        spec.file_size,
        spec.unknown6,
        spec.unknown7,
        spec.unknown8,
        spec.artwork_id,
        spec.key_id,
        spec.original_artist_id,
        spec.label_id,
        spec.remixer_id,
        spec.bitrate,
        spec.track_number,
        spec.tempo_centibpm,
        spec.genre_id,
        spec.album_id,
        spec.artist_id,
        spec.id,
        spec.disc_number,
        spec.play_count,
        spec.year,
        spec.sample_depth,
        spec.duration_secs,
        spec.unknown26,
        spec.color_id,
        spec.rating,
        spec.file_type,
        spec.unknown30,
    )
    assert len(fixed) == 94
    return fixed + struct.pack(f"<{len(offsets)}H", *offsets) + bytes(heap)


@dataclass
class ArtistRowSpec:
    id: int
    name: SqlString
    subtype: int = 0x60  # 0x60 near / 0x64 far
    index_shift: int = 0
    unknown3: int = 0x03

    def encode(self) -> bytes:
        name = self.name.encode()
        if self.subtype == 0x60:
            ofs = _aligned_ofs(10, self.name, name)
            head = struct.pack(
                "<HHIBB", self.subtype, self.index_shift, self.id, self.unknown3, ofs
            )
        elif self.subtype == 0x64:
            ofs = _aligned_ofs(12, self.name, name)
            head = struct.pack(
                "<HHIBBH", self.subtype, self.index_shift, self.id, self.unknown3, 0, ofs
            )
        else:
            raise ValueError(f"artist subtype {self.subtype:#x}")
        return head + b"\x00" * (ofs - len(head)) + name


@dataclass
class AlbumRowSpec:
    id: int
    name: SqlString
    artist_id: int = 0
    subtype: int = 0x80
    index_shift: int = 0
    unknown2: int = 0
    unknown5: int = 0
    unknown6: int = 0x03

    def encode(self) -> bytes:
        name = self.name.encode()
        if self.subtype & 4:
            ofs = _aligned_ofs(24, self.name, name)
            head = struct.pack(
                "<HHIIIIBBH",
                self.subtype,
                self.index_shift,
                self.unknown2,
                self.artist_id,
                self.id,
                self.unknown5,
                self.unknown6,
                0,
                ofs,
            )
        else:
            ofs = _aligned_ofs(22, self.name, name)
            head = struct.pack(
                "<HHIIIIBB",
                self.subtype,
                self.index_shift,
                self.unknown2,
                self.artist_id,
                self.id,
                self.unknown5,
                self.unknown6,
                ofs,
            )
        return head + b"\x00" * (ofs - len(head)) + name


@dataclass
class IdNameRowSpec:  # genres, labels, history playlists
    id: int
    name: SqlString

    def encode(self) -> bytes:
        return struct.pack("<I", self.id) + self.name.encode()


@dataclass
class KeyRowSpec:
    id: int
    name: SqlString
    id2: int | None = None

    def encode(self) -> bytes:
        id2 = self.id if self.id2 is None else self.id2
        return struct.pack("<II", self.id, id2) + self.name.encode()


@dataclass
class ColorRowSpec:
    id: int
    name: SqlString
    unknown0: bytes = b"\x00" * 5
    unknown2: int = 0

    def encode(self) -> bytes:
        return self.unknown0 + struct.pack("<HB", self.id, self.unknown2) + self.name.encode()


@dataclass
class ArtworkRowSpec:
    id: int
    path: SqlString

    def encode(self) -> bytes:
        return struct.pack("<I", self.id) + self.path.encode()


@dataclass
class PlaylistTreeRowSpec:
    id: int
    name: SqlString
    parent_id: int = 0
    sort_order: int = 0
    is_folder: bool = False
    unknown1: int = 0

    def encode(self) -> bytes:
        return (
            struct.pack(
                "<IIIII",
                self.parent_id,
                self.unknown1,
                self.sort_order,
                self.id,
                1 if self.is_folder else 0,
            )
            + self.name.encode()
        )


@dataclass
class PlaylistEntryRowSpec:
    entry_index: int
    track_id: int
    playlist_id: int

    def encode(self) -> bytes:
        return struct.pack("<III", self.entry_index, self.track_id, self.playlist_id)


@dataclass
class HistoryEntryRowSpec:
    track_id: int
    playlist_id: int
    entry_index: int

    def encode(self) -> bytes:
        return struct.pack("<III", self.track_id, self.playlist_id, self.entry_index)


@dataclass
class TagRowSpec:
    """exportExt.pdb tag/category row (near form; the corpus contains only
    subtype 0x680). The trailing unknown string is not modeled: encode()
    emits the 31-byte fixed header plus the name at ofs_name."""

    id: int
    name: SqlString
    tag_index: int = 0
    category: int = 0
    category_pos: int = 0
    # rekordbox writes 0x01000000 (not 1) for category rows, 0 for tags
    raw_is_category: int = 0
    subtype: int = 0x680
    unknown2: int = 0
    unknown7: int = 0x03

    HEADER_LEN = 31

    def encode_header(self, ofs_name: int, ofs_unknown: int) -> bytes:
        if self.subtype & 4:
            raise ValueError("far-form tag rows not supported")
        return struct.pack(
            "<HHQIIIIBBB",
            self.subtype,
            self.tag_index,
            self.unknown2,
            self.category,
            self.category_pos,
            self.id,
            self.raw_is_category,
            self.unknown7,
            ofs_name,
            ofs_unknown,
        )

    def encode(self) -> bytes:
        name = self.name.encode()
        ofs = _aligned_ofs(self.HEADER_LEN, self.name, name)
        # from-scratch: the unknown string is an empty short string after the name
        ofs_unknown = ofs + len(name)
        head = self.encode_header(ofs, ofs_unknown)
        return head + b"\x00" * (ofs - len(head)) + name + ShortAscii("").encode()


@dataclass
class TagTrackRowSpec:
    track_id: int
    tag_id: int
    unknown0: int = 0
    unknown3: int = 0

    def encode(self) -> bytes:
        return struct.pack("<IIII", self.unknown0, self.track_id, self.tag_id, self.unknown3)


def pad_track_row(spec: TrackRowSpec, comment_slot: int = 16) -> TrackRowSpec:
    """Pad the comment string until the encoded row clears MIN_TRACK_ROW_LEN."""
    row = encode_track_row(spec)
    deficit = MIN_TRACK_ROW_LEN - len(row)
    if deficit <= 0:
        return spec
    comment = spec.strings[comment_slot]
    text = comment.text if isinstance(comment, (ShortAscii, LongUtf16, LongAscii)) else ""
    spec.strings[comment_slot] = sql_string(text + " " * deficit)
    assert len(encode_track_row(spec)) >= MIN_TRACK_ROW_LEN
    return spec


# --- page encoding -----------------------------------------------------------


@dataclass
class PageHeaderSpec:
    page_index: int
    page_type: int
    next_page: int
    sequence: int = 1
    unknown6: bytes = b"\x00" * 4
    num_row_offsets: int = 0
    num_rows: int = 0
    page_flags: int = DATA_PAGE_FLAGS
    free_size: int = 0
    used_size: int = 0
    transaction_row_count: int = 0
    transaction_row_index: int = 0
    unknown14: int = 0
    unknown15: int = 0

    def encode(self) -> bytes:
        packed = self.num_row_offsets | (self.num_rows << 13)
        return (
            b"\x00" * 4
            + struct.pack("<IIII", self.page_index, self.page_type, self.next_page, self.sequence)
            + self.unknown6
            + packed.to_bytes(3, "little")
            + struct.pack(
                "<BHHHHHH",
                self.page_flags,
                self.free_size,
                self.used_size,
                self.transaction_row_count,
                self.transaction_row_index,
                self.unknown14,
                self.unknown15,
            )
        )


def encode_row_index(
    page: bytearray,
    offsets: list[int],
    present_flags: list[int] | None = None,
    transaction_flags: list[int] | None = None,
) -> None:
    """Write the backward-growing row index into `page` in place.

    `offsets` are heap-relative row offsets in row-index order. Group g
    occupies [len_page - (g+1)*36, len_page - g*36): sixteen u2 offsets at
    base-(6+2i), the presence bitmask at base-4, transaction bits at base-2.
    """
    num_groups = (len(offsets) - 1) // 16 + 1 if offsets else 0
    for group in range(num_groups):
        base = len(page) - group * ROW_GROUP_BYTES
        chunk = offsets[group * 16 : (group + 1) * 16]
        for i, ofs in enumerate(chunk):
            struct.pack_into("<H", page, base - (6 + 2 * i), ofs)
        if present_flags is not None:
            presence = present_flags[group]
        else:
            presence = (1 << len(chunk)) - 1
        struct.pack_into("<H", page, base - 4, presence)
        struct.pack_into("<H", page, base - 2, transaction_flags[group] if transaction_flags else 0)


def build_data_page(
    page_index: int,
    page_type: int,
    next_page: int,
    rows: list[bytes],
    *,
    sequence: int = 1,
    len_page: int = PAGE_LEN,
) -> bytes:
    """Lay rows into a fresh data page: heap forward from 0x28 with 4-byte
    row alignment, row index backward from the page end."""
    page = bytearray(len_page)
    offsets: list[int] = []
    pos = 0
    heap = bytearray()
    for row in rows:
        offsets.append(pos)
        heap += row
        pos += len(row)
        if pos % 4:
            pad = 4 - pos % 4
            heap += b"\x00" * pad
            pos += pad
    num_groups = (len(rows) - 1) // 16 + 1 if rows else 0
    index_bytes = num_groups * ROW_GROUP_BYTES
    if PAGE_HEADER_LEN + len(heap) + index_bytes > len_page:
        raise ValueError("rows do not fit in one page")
    used = len(heap)
    header = PageHeaderSpec(
        page_index=page_index,
        page_type=page_type,
        next_page=next_page,
        sequence=sequence,
        num_row_offsets=len(rows),
        num_rows=len(rows),
        page_flags=DATA_PAGE_FLAGS,
        used_size=used,
        free_size=len_page - PAGE_HEADER_LEN - used - (4 * num_groups + 2 * len(rows)),
    )
    page[:PAGE_HEADER_LEN] = header.encode()
    page[PAGE_HEADER_LEN : PAGE_HEADER_LEN + len(heap)] = heap
    encode_row_index(page, offsets)
    return bytes(page)


def build_index_page(
    page_index: int,
    page_type: int,
    next_page: int,
    *,
    first_data_page: int | None = None,
    sequence: int = 1,
    len_page: int = PAGE_LEN,
) -> bytes:
    """Native index page with an empty free-space entry array."""
    page = bytearray(len_page)
    header = PageHeaderSpec(
        page_index=page_index,
        page_type=page_type,
        next_page=next_page,
        sequence=sequence,
        page_flags=INDEX_PAGE_FLAGS,
        transaction_row_count=0x1FFF,
        transaction_row_index=0x1FFF,
        unknown14=INDEX_PAGE_MAGIC,
    )
    page[:PAGE_HEADER_LEN] = header.encode()
    # Unlike the row-only read oracle, Rekordbox validates the index body.
    struct.pack_into(
        "<IIQHH",
        page,
        PAGE_HEADER_LEN,
        page_index,
        first_data_page if first_data_page is not None else 0x03FFFFFF,
        0x03FFFFFF,
        0,
        0x1FFF,
    )
    slots_start = PAGE_HEADER_LEN + 20
    slots_end = len_page - 20
    page[slots_start:slots_end] = struct.pack("<I", 0x1FFFFFF8) * ((slots_end - slots_start) // 4)
    return bytes(page)


def fit_rows(rows: list[bytes], len_page: int = PAGE_LEN) -> list[list[bytes]]:
    """Split rows into page-sized chunks (heap + row index must fit)."""
    pages: list[list[bytes]] = []
    current: list[bytes] = []
    heap = 0
    for row in rows:
        padded = len(row) + (-len(row)) % 4
        groups = len(current) // 16 + 1
        if current and PAGE_HEADER_LEN + heap + padded + groups * ROW_GROUP_BYTES > len_page:
            pages.append(current)
            current, heap = [], 0
        current.append(row)
        heap += padded
    if current or not pages:
        pages.append(current)
    return pages


# --- whole-file building -----------------------------------------------------

# export.pdb table order as rekordbox writes it (types 0..19; 9, 10, 14, 15,
# 17, 18 are unknown-but-present empty tables).
EXPORT_TABLE_TYPES = list(range(20))

TABLE_TYPE = {
    "tracks": 0,
    "genres": 1,
    "artists": 2,
    "albums": 3,
    "labels": 4,
    "keys": 5,
    "colors": 6,
    "playlist_tree": 7,
    "playlist_entries": 8,
    "history_playlists": 11,
    "history_entries": 12,
    "artwork": 13,
    "columns": 16,
    "history": 19,
}


@dataclass
class TableData:
    page_type: int
    rows: list[bytes] = field(default_factory=list)


def build_pdb(
    tables: list[TableData],
    *,
    len_page: int = PAGE_LEN,
    sequence: int = 1,
    unknown4: int = 5,
) -> bytes:
    """Assemble a full database file from scratch.

    Every table gets an index page, its data pages, and a separate reserved
    zero page. The final link points to that table's reserved page.
    """
    # plan page allocation
    next_index = 1
    plans = []  # (table, index_page, chunks, data_page_indices, empty_candidate)
    for table in tables:
        index_page = next_index
        next_index += 1
        chunks = fit_rows(table.rows, len_page) if table.rows else []
        data_pages = list(range(next_index, next_index + len(chunks)))
        next_index += len(chunks)
        empty_candidate = next_index
        next_index += 1
        plans.append((table, index_page, chunks, data_pages, empty_candidate))
    num_pages = next_index

    pages: dict[int, bytes] = {}
    table_pointers = b""
    for table, index_page, chunks, data_pages, empty_candidate in plans:
        chain = data_pages + [empty_candidate]
        pages[index_page] = build_index_page(
            index_page,
            table.page_type,
            chain[0] if data_pages else empty_candidate,
            first_data_page=data_pages[0] if data_pages else None,
            sequence=sequence,
            len_page=len_page,
        )
        for i, (chunk, page_index) in enumerate(zip(chunks, data_pages)):
            pages[page_index] = build_data_page(
                page_index,
                table.page_type,
                chain[i + 1],
                chunk,
                sequence=sequence,
                len_page=len_page,
            )
        last_page = data_pages[-1] if data_pages else index_page
        table_pointers += struct.pack(
            "<IIII", table.page_type, empty_candidate, index_page, last_page
        )

    header = bytearray(len_page)
    head = (
        struct.pack("<IIIIII", 0, len_page, len(tables), num_pages, unknown4, sequence)
        + b"\x00" * 4
        + table_pointers
    )
    if len(head) > len_page:
        raise ValueError("too many tables for one header page")
    header[: len(head)] = head

    out = bytearray(bytes(header))
    for i in range(1, num_pages):
        out += pages.get(i, b"\x00" * len_page)
    return bytes(out)

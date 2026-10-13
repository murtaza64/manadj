"""Device read layer: export.pdb parsing against a synthesized fixture.

The fixture bytes are hand-built here (ADR 0004: no real export blobs in the
repo) and exercise the encoding subtleties the read layer must honor: page
chains with a leading index page, row-presence bitmasks (deleted rows are
never parsed), and DeviceSQL short-ASCII vs long-UTF-16LE strings.
"""

import struct

from rekordbox.device.pdb_read import read_pdb

PAGE_LEN = 4096
HEAP_POS = 0x28


def _page_header(
    page_index: int,
    page_type: int,
    next_page: int,
    *,
    num_row_offsets: int = 0,
    num_rows: int = 0,
    page_flags: int = 0x24,
) -> bytes:
    packed = num_row_offsets | (num_rows << 13)
    return (
        b"\x00" * 4
        + struct.pack("<III", page_index, page_type, next_page)
        + struct.pack("<I", 1)  # sequence
        + b"\x00" * 4
        + packed.to_bytes(3, "little")
        + struct.pack("<B", page_flags)
        + struct.pack("<HHHHHH", 0, 0, 0, 0, 0, 0)
    )


def _short_ascii(text: str) -> bytes:
    data = text.encode("ascii")
    return struct.pack("<B", ((len(data) + 1) << 1) | 1) + data


def _long_utf16le(text: str) -> bytes:
    data = text.encode("utf-16-le")
    return struct.pack("<BHB", 0x90, len(data) + 4, 0) + data


def _artist_row(artist_id: int, name_blob: bytes) -> bytes:
    # subtype 0x60 = nearby name offset; header is exactly 10 bytes
    return struct.pack("<HHIBB", 0x60, 0, artist_id, 0x03, 10) + name_blob


def _data_page_with_rows(page_index: int, page_type: int, next_page: int) -> bytes:
    row0 = _artist_row(1, _short_ascii("Aphex Twin"))
    row1 = _artist_row(2, _long_utf16le("Süper Ünïcode"))
    ofs0, ofs1, ofs2 = 0, len(row0), len(row0) + len(row1)
    heap = row0 + row1 + b"\xff" * 8  # third row: deleted garbage

    page = bytearray(PAGE_LEN)
    header = _page_header(
        page_index,
        page_type,
        next_page,
        num_row_offsets=3,
        num_rows=2,
        page_flags=0x24,
    )
    page[: len(header)] = header
    page[HEAP_POS : HEAP_POS + len(heap)] = heap
    base = PAGE_LEN  # row group 0
    struct.pack_into("<H", page, base - 4, 0b011)  # rows 0,1 present; 2 deleted
    struct.pack_into("<H", page, base - 6, ofs0)
    struct.pack_into("<H", page, base - 8, ofs1)
    struct.pack_into("<H", page, base - 10, ofs2)
    return bytes(page)


def _index_page(page_index: int, page_type: int, next_page: int) -> bytes:
    page = bytearray(PAGE_LEN)
    header = _page_header(page_index, page_type, next_page, page_flags=0x64)
    page[: len(header)] = header
    return bytes(page)


def _file_header(num_tables: int, tables: bytes) -> bytes:
    header = bytearray(PAGE_LEN)
    packed = struct.pack(
        "<IIIIII", 0, PAGE_LEN, num_tables, 3, 0, 5
    )  # gap, len_page, num_tables, next_unused, unnamed, sequence
    body = packed + b"\x00" * 4 + tables
    header[: len(body)] = body
    return bytes(header)


def synthesized_pdb() -> bytes:
    artists_type = 2
    table_ptr = struct.pack("<IIII", artists_type, 2, 1, 2)  # first=1 (index), last=2
    return (
        _file_header(1, table_ptr)
        + _index_page(1, artists_type, 2)
        + _data_page_with_rows(2, artists_type, 3)
    )


def write_fixture(tmp_path):
    path = tmp_path / "export.pdb"
    path.write_bytes(synthesized_pdb())
    return path


def test_parses_header_and_tables(tmp_path):
    pdb = read_pdb(write_fixture(tmp_path))
    assert pdb.len_page == PAGE_LEN
    assert pdb.num_tables == 1
    assert not pdb.is_ext
    assert set(pdb.tables) == {"artists"}


def test_skips_deleted_rows_and_decodes_strings(tmp_path):
    pdb = read_pdb(write_fixture(tmp_path))
    artists = pdb.tables["artists"]
    assert artists.row_count == 2  # third row's presence bit is 0
    names = [row.name for row in artists.rows]
    assert names == ["Aphex Twin", "Süper Ünïcode"]
    assert [row.id for row in artists.rows] == [1, 2]


def test_index_pages_carry_no_rows(tmp_path):
    # If the leading index page were treated as a data page, the walk would
    # yield phantom rows or crash; correct handling yields exactly 2.
    pdb = read_pdb(write_fixture(tmp_path))
    assert pdb.tables["artists"].row_count == 2


def test_ext_schema_inferred_from_filename(tmp_path):
    path = tmp_path / "exportExt.pdb"
    # ext file with zero tables: header only
    path.write_bytes(_file_header(0, b""))
    pdb = read_pdb(path)
    assert pdb.is_ext
    assert pdb.tables == {}

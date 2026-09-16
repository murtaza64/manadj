"""Native DeviceSQL invariants not checked by the row-reading Kaitai oracle."""

import struct

import pytest

from rekordbox.device.pdb_write import TableData, build_pdb


@pytest.mark.parametrize("rows", [[], [b"abcd"]])
def test_index_body_has_native_empty_entry_structure(rows):
    data = build_pdb([TableData(1, rows)])
    page = data[4096:8192]
    assert struct.unpack_from("<IIQHH", page, 0x28) == (
        1,
        2 if rows else 0x03FFFFFF,
        0x03FFFFFF,
        0,
        0x1FFF,
    )
    assert page[0x3C:0xFEC] == struct.pack("<I", 0x1FFFFFF8) * 1004
    assert page[0xFEC:] == bytes(20)


def test_tables_reserve_separate_empty_pages():
    data = build_pdb([TableData(1), TableData(2, [b"abcd"])])
    pointers = [struct.unpack_from("<IIII", data, 28 + 16 * i) for i in range(2)]
    assert len({p[1] for p in pointers}) == 2
    for _, empty, _, last in pointers:
        assert struct.unpack_from("<I", data, last * 4096 + 12)[0] == empty
        assert data[empty * 4096 : (empty + 1) * 4096] == bytes(4096)


@pytest.mark.parametrize("count", [1, 16, 17, 32, 33, 100])
def test_data_page_free_space_accounts_for_every_row_group(count):
    data = build_pdb([TableData(1, [bytes(8)] * count)])
    free, used = struct.unpack_from("<HH", data, 2 * 4096 + 28)
    assert free + used + 40 + 2 * count + 4 * ((count + 15) // 16) == 4096

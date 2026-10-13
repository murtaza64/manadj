"""Device pdb writer: encoders, hardware pitfalls, from-scratch builds.

The from-scratch builds are verified through the independent read oracle
(rekordbox/device/pdb_read over the Kaitai-generated parser) — writer and
verifier share no serialization code.
"""

import pytest

from rekordbox.device.pdb_read import read_pdb
from rekordbox.device.pdb_write import (
    MIN_TRACK_ROW_LEN,
    TABLE_TYPE,
    ArtistRowSpec,
    KeyRowSpec,
    LongAscii,
    LongUtf16,
    PlaylistEntryRowSpec,
    PlaylistTreeRowSpec,
    ShortAscii,
    TableData,
    TrackRowSpec,
    build_pdb,
    encode_track_row,
    fit_rows,
    pad_track_row,
    sql_string,
)


def track_spec(track_id: int, title: str = "Test Track", **overrides) -> TrackRowSpec:
    strings = [sql_string("") for _ in range(21)]
    strings[17] = sql_string(title)
    strings[19] = sql_string(f"track{track_id}.mp3")
    strings[20] = sql_string(f"/Contents/track{track_id}.mp3")
    strings[14] = sql_string(f"/PIONEER/USBANLZ/P000/{track_id:08X}/ANLZ0000.DAT")
    return TrackRowSpec(id=track_id, strings=strings, **overrides)


# --- string encoding ----------------------------------------------------------


def test_short_ascii_length_includes_flag_byte():
    assert ShortAscii("AB").encode() == bytes([(3 << 1) | 1]) + b"AB"
    assert ShortAscii("").encode() == bytes([(1 << 1) | 1])


def test_long_utf16_is_length_prefixed_exactly():
    encoded = LongUtf16("Aé").encode()
    assert encoded[0] == 0x90
    assert int.from_bytes(encoded[1:3], "little") == len(encoded)
    assert encoded[4:] == "Aé".encode("utf-16-le")


def test_sql_string_policy():
    assert isinstance(sql_string("plain"), ShortAscii)
    assert isinstance(sql_string("ünïcode"), LongUtf16)
    assert isinstance(sql_string("x" * 200), LongAscii)


def test_utf16_strings_are_4_byte_aligned_in_track_rows():
    spec = track_spec(1, title="Süper Track")
    row = encode_track_row(spec)
    # decode the offset table and check the utf16 title's alignment
    ofs_title = int.from_bytes(row[94 + 17 * 2 : 94 + 17 * 2 + 2], "little")
    assert row[ofs_title] == 0x90
    assert ofs_title % 4 == 0


# --- hardware pitfalls ---------------------------------------------------------


def test_track_rows_padded_to_min_length():
    spec = pad_track_row(track_spec(1))
    assert len(encode_track_row(spec)) >= MIN_TRACK_ROW_LEN


def test_rating_must_be_raw_byte_0_to_5():
    with pytest.raises(ValueError):
        track_spec(1, rating=255)


def test_track_row_needs_exactly_21_strings():
    with pytest.raises(ValueError):
        TrackRowSpec(id=1, strings=[sql_string("")] * 20)


# --- from-scratch builds --------------------------------------------------------


def build_and_read(tmp_path, tables):
    path = tmp_path / "export.pdb"
    path.write_bytes(build_pdb(tables))
    return read_pdb(path)


def test_from_scratch_pdb_parses_through_oracle(tmp_path):
    tables = [
        TableData(TABLE_TYPE["tracks"], [encode_track_row(pad_track_row(track_spec(1)))]),
        TableData(TABLE_TYPE["artists"], [ArtistRowSpec(id=1, name=sql_string("Artist")).encode()]),
        TableData(TABLE_TYPE["keys"], [KeyRowSpec(id=1, name=sql_string("8A")).encode()]),
        TableData(
            TABLE_TYPE["playlist_tree"],
            [PlaylistTreeRowSpec(id=1, name=sql_string("Set 1"), sort_order=1).encode()],
        ),
        TableData(
            TABLE_TYPE["playlist_entries"],
            [PlaylistEntryRowSpec(entry_index=1, track_id=1, playlist_id=1).encode()],
        ),
    ]
    pdb = build_and_read(tmp_path, tables)
    assert pdb.tables["tracks"].row_count == 1
    track = pdb.tables["tracks"].rows[0]
    assert track.title == "Test Track"
    assert track.file_path == "/Contents/track1.mp3"
    assert pdb.tables["artists"].rows[0].name == "Artist"
    assert pdb.tables["keys"].rows[0].name == "8A"
    assert pdb.tables["playlist_tree"].rows[0].name == "Set 1"
    entry = pdb.tables["playlist_entries"].rows[0]
    assert (entry.playlist_id, entry.track_id, entry.entry_index) == (1, 1, 1)


def test_from_scratch_unicode_survives_oracle(tmp_path):
    tables = [
        TableData(TABLE_TYPE["tracks"], [encode_track_row(pad_track_row(track_spec(1, title="Süper Ünïcode")))]),
        TableData(TABLE_TYPE["artists"], [ArtistRowSpec(id=1, name=sql_string("Àrtîst")).encode()]),
    ]
    pdb = build_and_read(tmp_path, tables)
    assert pdb.tables["tracks"].rows[0].title == "Süper Ünïcode"
    assert pdb.tables["artists"].rows[0].name == "Àrtîst"


def test_multi_group_and_multi_page_tables(tmp_path):
    # >16 rows exercises multiple row groups; enough rows spill to a second page
    rows = [
        encode_track_row(pad_track_row(track_spec(i, title=f"Track {i}")))
        for i in range(1, 41)
    ]
    assert len(fit_rows(rows)) > 1
    tables = [TableData(TABLE_TYPE["tracks"], rows)]
    pdb = build_and_read(tmp_path, tables)
    assert pdb.tables["tracks"].row_count == 40
    assert [t.id for t in pdb.tables["tracks"].rows] == list(range(1, 41))


def test_empty_tables_are_index_page_only(tmp_path):
    tables = [TableData(t) for t in range(20)]
    pdb = build_and_read(tmp_path, tables)
    assert pdb.num_tables == 20
    assert all(table.row_count == 0 for table in pdb.tables.values())

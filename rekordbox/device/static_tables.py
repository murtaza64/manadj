"""Device browse-column schema and default menu/sort rows (not library data)."""

from rekordbox.device.pdb_write import LongUtf16

# DeviceSQL column identifiers, independent of the displayed ordinal.
_COLUMNS = [
    (0x80, "GENRE"),
    (0x81, "ARTIST"),
    (0x82, "ALBUM"),
    (0x83, "TRACK"),
    (0x85, "BPM"),
    (0x86, "RATING"),
    (0x87, "YEAR"),
    (0x88, "REMIXER"),
    (0x89, "LABEL"),
    (0x8A, "ORIGINAL ARTIST"),
    (0x8B, "KEY"),
    (0x8D, "CUE"),
    (0x8E, "COLOR"),
    (0x92, "TIME"),
    (0x93, "BITRATE"),
    (0x94, "FILE NAME"),
    (0x84, "PLAYLIST"),
    (0x98, "HOT CUE BANK"),
    (0x95, "HISTORY"),
    (0x91, "SEARCH"),
    (0x96, "COMMENTS"),
    (0x8C, "DATE ADDED"),
    (0x97, "DJ PLAY COUNT"),
    (0x90, "FOLDER"),
    (0xA1, "DEFAULT"),
    (0xA2, "ALPHABET"),
    (0xAA, "MATCHING"),
]

COLUMNS_ROWS = [
    ordinal.to_bytes(2, "little")
    + kind.to_bytes(2, "little")
    + LongUtf16("\ufffa" + name + "\ufffb").encode()
    for ordinal, (kind, name) in enumerate(_COLUMNS, 1)
]

MENU_ROWS = [
    bytes.fromhex(row)
    for row in (
        "0100010063010000",
        "0500060005010000",
        "0600070063010000",
        "0700080063010000",
        "0800090063010000",
        "09000a0063010000",
        "0a000b0063010000",
        "0d000f0063010000",
        "0e00130004010000",
        "0f00140006010000",
        "1000150063010000",
        "1200170063010000",
        "0200020002000100",
        "0300030003000200",
        "0400040001000300",
        "0b000c0063000400",
        "1100050063000500",
        "1300160063000600",
        "1400120063000700",
        "1b001a0063020800",
        "1800110063000900",
        "16001b0063000a00",
    )
]

SORT_ROWS = [
    bytes.fromhex(row)
    for row in (
        "0100060001000000",
        "1500070001000000",
        "0e00080001000000",
        "0800090001000000",
        "09000a0001000000",
        "0a000b0001000000",
        "0f000d0001000000",
        "0d000f0001000000",
        "1700100001000000",
        "1600110001000000",
        "1900000000010000",
        "1a00010000020000",
        "0200020000030000",
        "0300030000040000",
        "0500040000050000",
        "0600050000060000",
        "0b000c0000070000",
    )
]

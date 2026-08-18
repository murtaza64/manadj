"""ANLZ (.DAT/.EXT/.2EX) serializer: big-endian tagged sections.

Encoders reproduce rekordbox's bytes exactly (proven by the corpus-gated
round-trip tests); constant header values (per-tag len_header, the PMAI
tail, PQTZ/PWAV magic words) are the ones rekordbox writes, verified
across every ANLZ file in the corpus.

Tags with un-reverse-engineered or out-of-scope bodies (PSSI song
structure with its XOR mask, PQT2, PVB2, PWVC) pass through verbatim via
RawSection.

Must not import the read layer / generated parsers (oracle independence).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

FILE_HEADER_LEN = 0x1C
# constant bytes rekordbox writes after len_file in the PMAI header
FILE_HEADER_TAIL = bytes.fromhex("00000001000100000001000000000000")

SECTION_HEADER_LEN = 12


def _section(fourcc: bytes, len_header: int, body: bytes) -> bytes:
    return fourcc + struct.pack(">II", len_header, SECTION_HEADER_LEN + len(body)) + body


@dataclass
class PathSection:  # PPTH
    path: str

    def encode(self) -> bytes:
        encoded = self.path.encode("utf-16-be") + b"\x00\x00"
        return _section(b"PPTH", 16, struct.pack(">I", len(encoded)) + encoded)


@dataclass
class VbrSection:  # PVBR
    index: list[int] = field(default_factory=lambda: [0] * 400)
    unknown0: int = 0

    def encode(self) -> bytes:
        # 400 entries normally; VBR-analyzed files carry 401
        body = struct.pack(">I", self.unknown0) + struct.pack(
            f">{len(self.index)}I", *self.index
        )
        return _section(b"PVBR", 16, body)


@dataclass
class Beat:
    beat_number: int  # 1-4 position within the bar
    tempo_centibpm: int
    time_ms: int


@dataclass
class BeatGridSection:  # PQTZ
    beats: list[Beat]
    unknown0: int = 0
    unknown1: int = 0x00080000  # constant in every corpus file

    def encode(self) -> bytes:
        body = struct.pack(">III", self.unknown0, self.unknown1, len(self.beats))
        for beat in self.beats:
            body += struct.pack(">HHI", beat.beat_number, beat.tempo_centibpm, beat.time_ms)
        return _section(b"PQTZ", 24, body)


NO_TIME = 0xFFFFFFFF


@dataclass
class CueEntry:  # PCPT
    hot_cue: int  # 0 = memory cue, 1-based slot otherwise
    time_ms: int
    type: int = 1  # 1 point / 2 loop
    loop_time_ms: int = NO_TIME
    status: int = 0
    order_first: int = 0xFFFF
    order_last: int = 0xFFFF
    unknown5: int = 0
    unknown9: bytes = b"\x00" * 3
    unknown12: bytes = b"\x00" * 16

    def encode(self) -> bytes:
        return (
            b"PCPT"
            + struct.pack(">II", 28, 56)
            + struct.pack(">III", self.hot_cue, self.status, self.unknown5)
            + struct.pack(">HH", self.order_first, self.order_last)
            + struct.pack(">B", self.type)
            + self.unknown9
            + struct.pack(">II", self.time_ms, self.loop_time_ms)
            + self.unknown12
        )


@dataclass
class CueListSection:  # PCOB
    list_type: int  # 0 memory cues / 1 hot cues
    cues: list[CueEntry] = field(default_factory=list)
    memory_count: int = 0
    unknown1: int = 0

    def encode(self) -> bytes:
        body = struct.pack(
            ">IHHI", self.list_type, self.unknown1, len(self.cues), self.memory_count
        ) + b"".join(c.encode() for c in self.cues)
        return _section(b"PCOB", 24, body)


@dataclass
class CueExtendedEntry:  # PCP2
    hot_cue: int
    time_ms: int
    type: int = 1
    loop_time_ms: int = NO_TIME
    color_id: int = 0
    comment: str = ""  # stored UTF-16BE, rekordbox appends a NUL
    color_code: int = 0
    color_rgb: tuple[int, int, int] = (0, 0, 0)
    loop_numerator: int = 0
    loop_denominator: int = 0
    unknown5: bytes = b"\x00" * 3
    unknown9: bytes = b"\x00" * 7
    tail: bytes = b""  # unknown trailing bytes after the color fields

    def encode(self) -> bytes:
        comment = self.comment.encode("utf-16-be")
        len_entry = 48 + len(comment) + len(self.tail)
        return (
            b"PCP2"
            + struct.pack(">II", 16, len_entry)
            + struct.pack(">I", self.hot_cue)
            + struct.pack(">B", self.type)
            + self.unknown5
            + struct.pack(">II", self.time_ms, self.loop_time_ms)
            + struct.pack(">B", self.color_id)
            + self.unknown9
            + struct.pack(">HH", self.loop_numerator, self.loop_denominator)
            + struct.pack(">I", len(comment))
            + comment
            + struct.pack(">BBBB", self.color_code, *self.color_rgb)
            + self.tail
        )


@dataclass
class CueExtendedListSection:  # PCO2
    list_type: int
    cues: list[CueExtendedEntry] = field(default_factory=list)
    unknown2: int = 0

    def encode(self) -> bytes:
        body = struct.pack(">IHH", self.list_type, len(self.cues), self.unknown2)
        body += b"".join(c.encode() for c in self.cues)
        return _section(b"PCO2", 20, body)


@dataclass
class WavePreviewSection:
    """PWAV (400x1 preview) / PWV2 (100x1 tiny preview): len_data-shaped."""

    fourcc: bytes  # b"PWAV" | b"PWV2"
    data: bytes
    unknown1: int = 0x00010000  # constant in every corpus file

    def encode(self) -> bytes:
        body = struct.pack(">II", len(self.data), self.unknown1) + self.data
        return _section(self.fourcc, 20, body)


# fourcc -> (len_header, entry bytes, has trailing unknown u4)
_ENTRY_SHAPED = {
    b"PWV3": (24, 1, True),  # mono scrolling detail
    b"PWV4": (24, 6, True),  # color preview
    b"PWV5": (24, 2, True),  # color scrolling detail
    b"PWV6": (20, 3, False),  # 3-band preview (no unknown word)
    b"PWV7": (24, 3, True),  # 3-band scrolling detail
}


@dataclass
class WaveEntrySection:
    """PWV3/PWV4/PWV5/PWV6/PWV7: {len_entry_bytes, len_entries[, unknown], data}."""

    fourcc: bytes
    entries: bytes
    len_entry_bytes: int | None = None
    unknown2: int = 0x00960000  # constant across corpus PWV3/4/5/7

    def encode(self) -> bytes:
        len_header, default_entry_bytes, has_unknown = _ENTRY_SHAPED[self.fourcc]
        entry_bytes = self.len_entry_bytes or default_entry_bytes
        if len(self.entries) % entry_bytes:
            raise ValueError(f"{self.fourcc!r} entries not a multiple of {entry_bytes}")
        body = struct.pack(">II", entry_bytes, len(self.entries) // entry_bytes)
        if has_unknown:
            body += struct.pack(">I", self.unknown2)
        body += self.entries
        return _section(self.fourcc, len_header, body)


@dataclass
class RawSection:
    """Verbatim passthrough (PSSI, PQT2, PVB2, PWVC, unknown tags)."""

    fourcc: bytes
    len_header: int
    body: bytes

    def encode(self) -> bytes:
        return _section(self.fourcc, self.len_header, self.body)


AnlzSection = (
    PathSection
    | VbrSection
    | BeatGridSection
    | CueListSection
    | CueExtendedListSection
    | WavePreviewSection
    | WaveEntrySection
    | RawSection
)


def build_anlz(sections: list[AnlzSection]) -> bytes:
    payload = b"".join(s.encode() for s in sections)
    header = (
        b"PMAI"
        + struct.pack(">II", FILE_HEADER_LEN, FILE_HEADER_LEN + len(payload))
        + FILE_HEADER_TAIL
    )
    assert len(header) == FILE_HEADER_LEN
    return header + payload

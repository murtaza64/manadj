"""Device read layer: ANLZ parsing against a synthesized fixture.

Hand-built big-endian tagged sections (ADR 0004): PPTH, PQTZ, PCOB, plus an
unknown tag that must be surfaced gracefully rather than crashing.
"""

import struct

from rekordbox.device.anlz_read import read_anlz

AUDIO_PATH = "/Contents/test.mp3"


def _section(fourcc: bytes, len_header: int, body: bytes) -> bytes:
    return fourcc + struct.pack(">II", len_header, len(body) + 12) + body


def _ppth() -> bytes:
    encoded = AUDIO_PATH.encode("utf-16-be") + b"\x00\x00"
    return _section(b"PPTH", 16, struct.pack(">I", len(encoded)) + encoded)


def _pqtz(beats: list[tuple[int, int, int]]) -> bytes:
    body = struct.pack(">III", 0, 0x80000, len(beats))
    for beat_number, tempo, time in beats:
        body += struct.pack(">HHI", beat_number, tempo, time)
    return _section(b"PQTZ", 24, body)


def _cue_entry(hot_cue: int, time_ms: int) -> bytes:
    return (
        b"PCPT"
        + struct.pack(">II", 28, 56)  # len_header, len_entry
        + struct.pack(">II", hot_cue, 1)  # hot_cue, status=enabled
        + struct.pack(">I", 0)
        + struct.pack(">HH", 0xFFFF, 0)
        + struct.pack(">B", 1)  # type = memory_cue/point
        + b"\x00" * 3
        + struct.pack(">II", time_ms, 0xFFFFFFFF)
        + b"\x00" * 16
    )


def _pcob(cues: list[bytes], list_type: int = 0) -> bytes:
    body = struct.pack(">IHHI", list_type, 0, len(cues), 0xFFFFFFFF) + b"".join(cues)
    return _section(b"PCOB", 24, body)


def _unknown() -> bytes:
    return _section(b"PXXX", 12, b"\xde\xad\xbe\xef")


def synthesized_anlz() -> bytes:
    sections = (
        _ppth()
        + _pqtz([(1, 12800, 21), (2, 12800, 490), (3, 12800, 959), (4, 12800, 1428)])
        + _pcob([_cue_entry(0, 1425)])
        + _unknown()
    )
    len_header = 0x1C
    total = len_header + len(sections)
    header = b"PMAI" + struct.pack(">II", len_header, total)
    header += b"\x00" * (len_header - len(header))
    return header + sections


def write_fixture(tmp_path):
    path = tmp_path / "ANLZ0000.DAT"
    path.write_bytes(synthesized_anlz())
    return path


def test_parses_path_grid_and_cues(tmp_path):
    data = read_anlz(write_fixture(tmp_path))
    assert data.audio_path == AUDIO_PATH
    assert [b.time_ms for b in data.beats] == [21, 490, 959, 1428]
    assert [b.beat_number for b in data.beats] == [1, 2, 3, 4]
    assert all(b.tempo_centibpm == 12800 for b in data.beats)
    assert len(data.cues) == 1
    cue = data.cues[0]
    assert cue.time_ms == 1425
    assert cue.list_type == "memory_cues"
    assert cue.status == "enabled"


def test_unknown_sections_are_surfaced_not_fatal(tmp_path):
    data = read_anlz(write_fixture(tmp_path))
    fourccs = [s.fourcc for s in data.sections]
    assert fourccs == ["PPTH", "PQTZ", "PCOB", "PXXX"]

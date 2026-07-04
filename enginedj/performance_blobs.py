"""Decoding of Engine DJ PerformanceData BLOBs (beatData, quickCues).

Blob format per the Mixxx wiki (Engine Library Format) and libdjinterop:

- BLOBs are qCompress-framed: 4-byte big-endian uncompressed length + zlib.
- beatData: sample rate (f64 BE), track length in samples (f64 BE),
  is-set byte, then two beatgrids (default, adjusted). Each grid: marker
  count (i64 BE), then markers of (sample offset f64 LE, beat index i64 LE,
  beats-to-next u32 LE, unknown u32 LE). First marker is beat -4.
- quickCues: cue count (i64 BE, always 8), then per cue: label length byte,
  label bytes, position in samples (f64 BE, -1 if unset), ARGB bytes; then
  main cue position (f64 BE), is-overridden byte, default cue (f64 BE).

Positions are samples; divide by the blob's own sample rate for seconds.
"""

import struct
import zlib
from dataclasses import dataclass

PLAUSIBLE_SAMPLE_RATES = (22050.0, 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0)


class BlobParseError(Exception):
    pass


def q_uncompress(blob: bytes) -> bytes:
    """Undo Qt's qCompress framing: u32 BE uncompressed length + zlib stream."""
    if len(blob) < 5:
        raise BlobParseError(f"blob too short ({len(blob)} bytes)")
    (expected_len,) = struct.unpack(">I", blob[:4])
    try:
        data = zlib.decompress(blob[4:])
    except zlib.error as e:
        raise BlobParseError(f"zlib decompression failed: {e}") from e
    if len(data) != expected_len:
        raise BlobParseError(f"length prefix {expected_len} != decompressed {len(data)}")
    return data


class _Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def read(self, fmt: str) -> float | int:
        size = struct.calcsize(fmt)
        if self.pos + size > len(self.data):
            raise BlobParseError(f"unexpected end of blob at {self.pos} (want {size} bytes)")
        (value,) = struct.unpack_from(fmt, self.data, self.pos)
        self.pos += size
        return value  # type: ignore[no-any-return]

    def read_bytes(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise BlobParseError(f"unexpected end of blob at {self.pos} (want {n} bytes)")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    @property
    def remaining(self) -> int:
        return len(self.data) - self.pos


@dataclass
class GridMarker:
    sample_offset: float
    beat_index: int
    beats_to_next: int


@dataclass
class BeatData:
    sample_rate: float
    track_length_samples: float
    default_grid: list[GridMarker]
    adjusted_grid: list[GridMarker]


@dataclass
class EngineHotCue:
    slot: int  # 0-7
    label: str
    sample_offset: float
    color_hex: str  # "#RRGGBB"


@dataclass
class QuickCues:
    hot_cues: list[EngineHotCue]  # only set slots
    main_cue_samples: float
    main_cue_overridden: bool
    default_cue_samples: float


def parse_beat_data(blob: bytes) -> BeatData:
    r = _Reader(q_uncompress(blob))
    sample_rate = float(r.read(">d"))
    if sample_rate not in PLAUSIBLE_SAMPLE_RATES:
        raise BlobParseError(f"implausible sample rate {sample_rate!r} — endianness/format drift?")
    track_length = float(r.read(">d"))
    is_set = r.read("B")
    if is_set != 1:
        raise BlobParseError(f"beat data is-set flag = {is_set}, expected 1")

    def read_grid() -> list[GridMarker]:
        count = int(r.read(">q"))
        # Heavily warped grids (e.g. Serato imports) can carry hundreds of
        # markers; bound by what the blob could physically hold (24 B/marker).
        if not (0 <= count <= r.remaining // 24):
            raise BlobParseError(f"implausible marker count {count} ({r.remaining} bytes left)")
        markers = []
        for _ in range(count):
            offset = float(r.read("<d"))
            index = int(r.read("<q"))
            beats_to_next = int(r.read("<I"))
            r.read("<I")  # unknown field
            markers.append(GridMarker(offset, index, beats_to_next))
        return markers

    default_grid = read_grid()
    adjusted_grid = read_grid()
    return BeatData(sample_rate, track_length, default_grid, adjusted_grid)


def parse_quick_cues(blob: bytes) -> QuickCues:
    r = _Reader(q_uncompress(blob))
    count = int(r.read(">q"))
    if not (0 <= count <= 64):
        raise BlobParseError(f"implausible hot cue count {count}")

    cues: list[EngineHotCue] = []
    for slot in range(count):
        label_len = int(r.read("B"))
        label = r.read_bytes(label_len).decode("utf-8", errors="replace")
        position = float(r.read(">d"))
        _a, red, green, blue = (r.read("B"), r.read("B"), r.read("B"), r.read("B"))
        if label_len > 0 or position >= 0:
            cues.append(EngineHotCue(slot, label, position, f"#{red:02X}{green:02X}{blue:02X}"))

    main_cue = float(r.read(">d"))
    overridden = bool(r.read("B"))
    default_cue = float(r.read(">d"))
    return QuickCues(cues, main_cue, overridden, default_cue)

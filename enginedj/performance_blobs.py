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


def q_compress(data: bytes) -> bytes:
    """Apply Qt's qCompress framing."""
    return struct.pack(">I", len(data)) + zlib.compress(data)


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
    unknown: int = 0


@dataclass
class BeatData:
    sample_rate: float
    track_length_samples: float
    default_grid: list[GridMarker]
    adjusted_grid: list[GridMarker]
    is_set: bool = True
    tail: bytes = b""


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
    slot_count: int = 8


@dataclass
class TrackData:
    sample_rate: float
    track_length_samples: int
    key: int
    loudness: list[float]


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
            unknown = int(r.read("<I"))
            markers.append(GridMarker(offset, index, beats_to_next, unknown))
        return markers

    default_grid = read_grid()
    adjusted_grid = read_grid()
    if r.remaining not in (0, 9):
        raise BlobParseError(f"unexpected beat data tail ({r.remaining} bytes)")
    tail = r.read_bytes(r.remaining)
    return BeatData(sample_rate, track_length, default_grid, adjusted_grid, True, tail)


def encode_beat_data(data: BeatData) -> bytes:
    body = struct.pack(">ddB", data.sample_rate, data.track_length_samples, int(data.is_set))
    for grid in (data.default_grid, data.adjusted_grid):
        body += struct.pack(">q", len(grid))
        for marker in grid:
            body += struct.pack(
                "<dqII",
                marker.sample_offset,
                marker.beat_index,
                marker.beats_to_next,
                marker.unknown,
            )
    return q_compress(body + data.tail)


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
    return QuickCues(cues, main_cue, overridden, default_cue, count)


def encode_quick_cues(data: QuickCues) -> bytes:
    by_slot = {cue.slot: cue for cue in data.hot_cues}
    body = struct.pack(">q", data.slot_count)
    for slot in range(data.slot_count):
        cue = by_slot.get(slot)
        if cue is None:
            label = b""
            position = -1.0
            color = bytes((255, 0, 0, 0))
        else:
            label = cue.label.encode("utf-8")
            if len(label) > 255:
                raise ValueError("Engine hot cue labels are limited to 255 UTF-8 bytes")
            position = cue.sample_offset
            rgb = cue.color_hex.removeprefix("#")
            if len(rgb) != 6:
                raise ValueError(f"invalid cue color {cue.color_hex!r}")
            color = bytes.fromhex(f"ff{rgb}")
        body += bytes((len(label),)) + label + struct.pack(">d", position) + color
    body += struct.pack(">dB", data.main_cue_samples, int(data.main_cue_overridden))
    body += struct.pack(">d", data.default_cue_samples)
    return q_compress(body)


def parse_track_data(blob: bytes) -> TrackData:
    raw = q_uncompress(blob)
    if len(raw) not in (44, 68):
        raise BlobParseError(f"trackData length {len(raw)} not in (44, 68)")
    sample_rate, length_samples, key = struct.unpack_from(">dQI", raw)
    loudness = list(struct.unpack_from(f">{(len(raw) - 20) // 8}d", raw, 20))
    return TrackData(sample_rate, length_samples, key, loudness)


def encode_track_data(data: TrackData) -> bytes:
    raw = struct.pack(">dQI", data.sample_rate, data.track_length_samples, data.key)
    raw += struct.pack(f">{len(data.loudness)}d", *data.loudness)
    return q_compress(raw)

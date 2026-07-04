"""Tests for enginedj.performance_blobs — Engine PerformanceData blob decoding.

Per ADR 0004, no real Engine blobs are committed. These tests decode blobs
synthesized by a builder implementing the documented format (Mixxx wiki
"Engine Library Format" / libdjinterop): qCompress framing, beatData grid
markers, quickCues slot layout.
"""

import struct
import zlib

import pytest

from enginedj.performance_blobs import (
    BlobParseError,
    parse_beat_data,
    parse_quick_cues,
    q_uncompress,
)

# ── Synthesized blob builders (the documented format, test-local) ─────────


def q_compress(data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + zlib.compress(data)


def build_marker(sample_offset: float, beat_index: int, beats_to_next: int) -> bytes:
    return struct.pack("<dqII", sample_offset, beat_index, beats_to_next, 0)


def build_beat_blob(
    sample_rate: float = 44100.0,
    track_length_samples: float = 44100.0 * 180,
    default_grid: list[tuple[float, int, int]] = (),
    adjusted_grid: list[tuple[float, int, int]] = (),
    is_set: int = 1,
    compress: bool = True,
) -> bytes:
    body = struct.pack(">ddB", sample_rate, track_length_samples, is_set)
    for grid in (default_grid, adjusted_grid):
        body += struct.pack(">q", len(grid))
        for offset, index, beats_to_next in grid:
            body += build_marker(offset, index, beats_to_next)
    return q_compress(body) if compress else body


def build_cue_slot(label: str, position_samples: float, rgb: tuple[int, int, int]) -> bytes:
    encoded = label.encode("utf-8")
    return (
        struct.pack("B", len(encoded))
        + encoded
        + struct.pack(">d", position_samples)
        + bytes([255, *rgb])  # ARGB
    )


EMPTY_SLOT = build_cue_slot("", -1.0, (0, 0, 0))


def build_quick_cues_blob(
    slots: list[bytes],
    main_cue_samples: float = 0.0,
    overridden: bool = False,
    default_cue_samples: float = 0.0,
) -> bytes:
    body = struct.pack(">q", len(slots))
    for slot in slots:
        body += slot
    body += struct.pack(">d", main_cue_samples)
    body += struct.pack("B", 1 if overridden else 0)
    body += struct.pack(">d", default_cue_samples)
    return q_compress(body)


# A clean constant 128 BPM grid at 44100 Hz: beat -4 at sample offset such
# that beat 0 lands at 0.5s. samples_per_beat = 44100 * 60 / 128.
SPB_128 = 44100.0 * 60.0 / 128.0
CONSTANT_GRID = [
    (0.5 * 44100.0 - 4 * SPB_128, -4, 4),
    (0.5 * 44100.0, 0, 0),
]


# ── qCompress framing ─────────────────────────────────────────────────────


def test_q_uncompress_roundtrip() -> None:
    assert q_uncompress(q_compress(b"hello world")) == b"hello world"


def test_q_uncompress_rejects_short_blob() -> None:
    with pytest.raises(BlobParseError, match="too short"):
        q_uncompress(b"\x00\x01")


def test_q_uncompress_rejects_length_mismatch() -> None:
    framed = struct.pack(">I", 999) + zlib.compress(b"abc")
    with pytest.raises(BlobParseError, match="length prefix"):
        q_uncompress(framed)


# ── beatData ──────────────────────────────────────────────────────────────


def test_parse_beat_data_constant_grid() -> None:
    blob = build_beat_blob(default_grid=CONSTANT_GRID, adjusted_grid=CONSTANT_GRID)
    beat_data = parse_beat_data(blob)
    assert beat_data.sample_rate == 44100.0
    assert beat_data.track_length_samples == 44100.0 * 180
    assert len(beat_data.default_grid) == 2
    assert len(beat_data.adjusted_grid) == 2
    first = beat_data.adjusted_grid[0]
    assert first.beat_index == -4
    assert first.beats_to_next == 4
    assert first.sample_offset == pytest.approx(0.5 * 44100.0 - 4 * SPB_128)


def test_parse_beat_data_variable_grid() -> None:
    variable = CONSTANT_GRID + [(0.5 * 44100.0 + 64 * SPB_128, 64, 0)]
    blob = build_beat_blob(adjusted_grid=variable)
    beat_data = parse_beat_data(blob)
    assert [m.beat_index for m in beat_data.adjusted_grid] == [-4, 0, 64]


def test_parse_beat_data_rejects_implausible_sample_rate() -> None:
    blob = build_beat_blob(sample_rate=12345.0, adjusted_grid=CONSTANT_GRID)
    with pytest.raises(BlobParseError, match="sample rate"):
        parse_beat_data(blob)


def test_parse_beat_data_rejects_unset_flag() -> None:
    blob = build_beat_blob(adjusted_grid=CONSTANT_GRID, is_set=0)
    with pytest.raises(BlobParseError, match="is-set"):
        parse_beat_data(blob)


def test_parse_beat_data_rejects_marker_count_beyond_blob() -> None:
    # Declare 1000 markers but supply none.
    body = struct.pack(">ddB", 44100.0, 1000.0, 1) + struct.pack(">q", 1000)
    with pytest.raises(BlobParseError, match="marker count"):
        parse_beat_data(q_compress(body))


def test_parse_beat_data_rejects_truncated_blob() -> None:
    # Truncation may surface as an implausible marker count (the count is
    # bounded by remaining bytes) or as an unexpected end — either way it
    # must be a BlobParseError, never a struct.error.
    blob = build_beat_blob(adjusted_grid=CONSTANT_GRID, compress=False)
    with pytest.raises(BlobParseError):
        parse_beat_data(q_compress(blob[:-8]))


# ── quickCues ─────────────────────────────────────────────────────────────


def test_parse_quick_cues_set_and_unset_slots() -> None:
    slots = [
        build_cue_slot("Drop", 44100.0 * 30, (255, 0, 128)),
        EMPTY_SLOT,
        build_cue_slot("", 44100.0 * 60, (0, 255, 0)),  # position set, no label
    ] + [EMPTY_SLOT] * 5
    cues = parse_quick_cues(build_quick_cues_blob(slots))
    assert [(c.slot, c.label) for c in cues.hot_cues] == [(0, "Drop"), (2, "")]
    assert cues.hot_cues[0].sample_offset == pytest.approx(44100.0 * 30)
    assert cues.hot_cues[0].color_hex == "#FF0080"
    assert cues.hot_cues[1].color_hex == "#00FF00"


def test_parse_quick_cues_main_cue_and_overridden_flag() -> None:
    blob = build_quick_cues_blob(
        [EMPTY_SLOT] * 8,
        main_cue_samples=44100.0 * 15,
        overridden=True,
        default_cue_samples=44100.0 * 1,
    )
    cues = parse_quick_cues(blob)
    assert cues.hot_cues == []
    assert cues.main_cue_samples == pytest.approx(44100.0 * 15)
    assert cues.main_cue_overridden is True
    assert cues.default_cue_samples == pytest.approx(44100.0)


def test_parse_quick_cues_not_overridden() -> None:
    cues = parse_quick_cues(build_quick_cues_blob([EMPTY_SLOT] * 8, overridden=False))
    assert cues.main_cue_overridden is False


def test_parse_quick_cues_rejects_implausible_count() -> None:
    body = struct.pack(">q", 500)
    with pytest.raises(BlobParseError, match="hot cue count"):
        parse_quick_cues(q_compress(body))


def test_parse_quick_cues_non_utf8_label_replaced() -> None:
    slot = struct.pack("B", 2) + b"\xff\xfe" + struct.pack(">d", 44100.0) + bytes([255, 1, 2, 3])
    cues = parse_quick_cues(build_quick_cues_blob([slot] + [EMPTY_SLOT] * 7))
    assert cues.hot_cues[0].label == "\ufffd\ufffd"

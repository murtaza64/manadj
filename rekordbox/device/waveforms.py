"""Device waveforms derived from manadj's decoded peak and spectral envelopes.

The formats and 150 Hz detail clock follow Deep Symmetry's ANLZ analysis;
the amplitude/color rendering is ours, not a replica of Rekordbox analysis.
"""

import math

import numpy as np

from backend.waveform_data import decode_blob, generate_blob
from rekordbox.device.anlz_write import WaveEntrySection, WavePreviewSection


def build_waveforms(source: str, *, blob: bytes | None = None, offset_s: float = 0):
    data = decode_blob(blob if blob is not None else generate_blob(str(source)))
    duration = max(0, data["duration"] + offset_s)
    count = max(1, math.ceil(duration * 150))
    times = np.arange(count) / 150 - offset_s
    # Pool every source peak into overlapping detail bins; point sampling can
    # skip a transient entirely when reducing the source's ~345 Hz clock.
    edges = np.arange(len(data["peaks"]) + 1) * data["peak_hop"] / data["sample_rate"]
    peak = np.zeros(count)
    for indices in (
        np.floor((edges[:-1] + offset_s) * 150).astype(int),
        np.ceil((edges[1:] + offset_s) * 150).astype(int) - 1,
    ):
        valid = (indices >= 0) & (indices < count)
        np.maximum.at(peak, indices[valid], data["peaks"][valid] / 255)
    outside = (times < 0) | (times >= data["duration"])
    peak[outside] = 0
    band_times = (
        np.arange(len(data["bands"])) * data["band_hop"] + data["stft_window"] / 2
    ) / data["sample_rate"]
    bands = (
        np.column_stack(
            [
                np.interp(times, band_times, data["bands"][:, indices].max(axis=1))
                for indices in ([0, 1, 2], [3, 4], [5, 6, 7])
            ]
        )
        / 255
    )
    bands[outside] = 0
    rgb = np.rint(7 * bands / np.maximum(bands.max(axis=1, keepdims=True), 1e-9)).astype(np.uint16)
    height = np.rint(31 * peak).astype(np.uint16)
    whiteness = np.rint(7 * bands[:, 2]).astype(np.uint8)
    mono = (height | (whiteness.astype(np.uint16) << 5)).astype(np.uint8)
    color = (rgb[:, 0] << 13) | (rgb[:, 1] << 10) | (rgb[:, 2] << 7) | (height << 2)

    previews = []
    level = np.sqrt(np.mean(bands**2, axis=1))
    for kind, bins, max_height in ((b"PWAV", 400, 31), (b"PWV2", 100, 15)):
        pooled = np.zeros(bins)
        dest = np.minimum(np.arange(count) * bins // count, bins - 1)
        np.add.at(pooled, dest, level)
        pooled /= np.maximum(np.bincount(dest, minlength=bins), 1)
        # Upsampling short fixtures should not introduce artificial empty columns.
        if count < bins:
            pooled = np.interp(np.arange(bins) * count / bins, np.arange(count), level)
        previews.append(
            WavePreviewSection(kind, np.rint(pooled * max_height).astype(np.uint8).tobytes())
        )

    preview = np.zeros((1200, 4))
    dest = np.minimum(np.arange(count) * 1200 // count, 1199)
    np.maximum.at(preview, dest, np.column_stack([peak, bands]))
    if count < 1200:
        preview = np.column_stack(
            [
                np.interp(np.arange(1200) * count / 1200, np.arange(count), channel)
                for channel in (peak, *bands.T)
            ]
        )
    color_preview = np.column_stack(
        [
            np.rint(preview[:, 3] * 7),
            np.rint(preview[:, 0] * 31),
            np.rint(preview[:, 0] * 127),
            np.rint(preview[:, 1:] * 127),
        ]
    ).astype(np.uint8)
    extended = [
        WaveEntrySection(b"PWV3", mono.tobytes()),
        WaveEntrySection(b"PWV4", color_preview.tobytes(), unknown2=0),
        WaveEntrySection(b"PWV5", color.astype(">u2").tobytes()),
    ]
    # Three-band tags store mid, high, low heights, not RGB. Rekordbox's
    # 3Band browser column requires PWV6 and does not fall back to PWAV/PWV4.
    extra = [
        WaveEntrySection(b"PWV7", np.rint(bands[:, [1, 2, 0]] * 127).astype(np.uint8).tobytes()),
        WaveEntrySection(b"PWV6", np.rint(preview[:, [2, 3, 1]] * 63).astype(np.uint8).tobytes()),
    ]
    return previews, extended, extra

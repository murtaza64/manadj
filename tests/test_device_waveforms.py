import struct

import numpy as np

from backend.waveform_data import build_blob
from rekordbox.device.waveforms import build_waveforms


def test_waveforms_have_native_sizes_and_preserve_silence():
    peaks = np.concatenate([np.zeros(345, dtype=np.uint8), np.full(345, 180, dtype=np.uint8)])
    bands = np.zeros((173, 8), dtype=np.uint8)
    bands[87:, 1] = 200
    blob = build_blob(peaks, bands, 2.0)
    dat, ext, extra = build_waveforms("unused.mp3", blob=blob)
    assert [s.fourcc for s in dat] == [b"PWAV", b"PWV2"]
    assert [len(s.data) for s in dat] == [400, 100]
    assert not any(dat[0].data[:190])
    assert any(dat[0].data[210:])
    by_kind = {s.fourcc: s for s in ext}
    assert len(by_kind[b"PWV3"].entries) == 300
    assert len(by_kind[b"PWV4"].entries) == 7200
    assert struct.unpack_from(">I", by_kind[b"PWV4"].encode(), 20)[0] == 0
    assert len(by_kind[b"PWV5"].entries) == 600
    detail = np.frombuffer(by_kind[b"PWV5"].entries, dtype=">u2")
    assert not np.any(detail[:140])
    assert np.all((detail[160:] >> 13) > ((detail[160:] >> 10) & 7))
    by_kind = {s.fourcc: s for s in extra}
    assert len(by_kind[b"PWV6"].entries) == 1200 * 3
    assert len(by_kind[b"PWV7"].entries) == 300 * 3
    for kind in (b"PWV6", b"PWV7"):
        values = np.frombuffer(by_kind[kind].entries, np.uint8).reshape(-1, 3)
        assert not np.any(values[: len(values) // 2 - 20])
        # Low-frequency-only input belongs in the third channel, not the first.
        assert not np.any(values[:, :2])
        assert np.any(values[:, 2])


def test_waveform_offset_shifts_content_not_duration():
    peaks = np.full(345, 255, dtype=np.uint8)
    blob = build_blob(peaks, np.ones((87, 8), dtype=np.uint8), 1.0)
    _, ext, extra = build_waveforms("unused.mp3", blob=blob, offset_s=0.1)
    detail = next(s for s in ext if s.fourcc == b"PWV3").entries
    assert len(detail) == 165
    assert not any(detail[:15])
    assert any(detail[16:])
    three_band = next(s for s in extra if s.fourcc == b"PWV7").entries
    assert len(three_band) == 165 * 3
    assert not any(three_band[: 15 * 3])


def test_detail_preserves_transients_between_destination_sample_centers():
    peaks = np.zeros(345, dtype=np.uint8)
    peaks[3] = 255
    blob = build_blob(peaks, np.zeros((87, 8), dtype=np.uint8), 1.0)
    _, ext, _ = build_waveforms("unused.mp3", blob=blob)
    by_kind = {s.fourcc: s for s in ext}
    assert any(v & 31 for v in by_kind[b"PWV3"].entries)
    assert np.any(np.frombuffer(by_kind[b"PWV5"].entries, dtype=">u2") & 0x7C)

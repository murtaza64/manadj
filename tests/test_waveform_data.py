"""Waveform data v2 (ADR 0014): generation, blob format, and the binary endpoint.

Per ADR-0002 these run the real pipeline — real ffmpeg over committed synthetic
fixtures (tones inside known bands + an impulse click), real in-memory SQLite,
TestClient over the waveforms router. The "audio analysis" fake carve-out
targeted heavyweight analyzers; this pipeline runs 2-second fixtures in
milliseconds, and real is what catches decode/format bugs.
"""

from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import models
from backend.database import get_db
from backend.routers import waveforms as waveforms_router
from backend.waveform_data import (
    BAND_EDGES,
    BAND_HOP,
    GAMMA,
    N_BANDS,
    PEAK_HOP,
    SAMPLE_RATE,
    STFT_WINDOW,
    FORMAT_VERSION,
    decode_blob,
    generate_blob,
)

FIXTURES = Path(__file__).parent / "fixtures"

# (fixture stem, expected dominant band index). Note: the sub-band tone is
# 40 Hz, not 50 — at window 2048 a 50 Hz tone's Hann main lobe genuinely
# straddles the 60 Hz band edge (band 0 is only ~2 FFT bins wide).
TONES = [
    ("tone_40hz", 0),   # 20-60 Hz
    ("tone_1500hz", 4),  # 1-2.5 kHz
    ("tone_8khz", 6),   # 6-12 kHz
]


def _dequantize(q: np.ndarray) -> np.ndarray:
    return (q.astype(np.float32) / 255.0) ** (1.0 / GAMMA)


# ---------------------------------------------------------------- generation


@pytest.mark.parametrize("fmt", ["wav", "m4a"])
@pytest.mark.parametrize("stem,expected_band", TONES)
def test_tone_energy_lands_in_expected_band(stem, expected_band, fmt):
    blob = generate_blob(str(FIXTURES / f"{stem}.{fmt}"))
    d = decode_blob(blob)
    # Steady-state region (skip onset/decay edges).
    bands = _dequantize(d["bands"])
    mid = bands[len(bands) // 4 : -len(bands) // 4]
    means = mid.mean(axis=0)
    assert int(means.argmax()) == expected_band, means
    # Neighbors stay well below the dominant band (window leakage bounded).
    for neighbor in (expected_band - 1, expected_band + 1):
        if 0 <= neighbor < N_BANDS:
            assert means[neighbor] < 0.5 * means[expected_band], means
    # A -6 dBFS sine should read amplitude ~0.5 in its band.
    assert 0.3 < means[expected_band] < 0.7


@pytest.mark.parametrize("fmt", ["wav", "m4a"])
def test_impulse_spikes_peak_channel_at_expected_bin(fmt):
    blob = generate_blob(str(FIXTURES / f"impulse.{fmt}"))
    d = decode_blob(blob)
    peaks = d["peaks"]
    expected = int(1.0 * SAMPLE_RATE / PEAK_HOP)  # click at t=1.0s
    tolerance = 20 if fmt == "m4a" else 2  # aac codec delay shifts a little
    spike = int(peaks.argmax())
    assert abs(spike - expected) <= tolerance, (spike, expected)
    # Quiet everywhere away from the click (aac ringing stays small).
    away = np.concatenate([peaks[: spike - 40], peaks[spike + 40 :]])
    assert away.max() < 30


def test_header_and_size_arithmetic():
    blob = generate_blob(str(FIXTURES / "tone_1500hz.wav"))
    d = decode_blob(blob)
    assert d["version"] == FORMAT_VERSION
    assert d["sample_rate"] == SAMPLE_RATE
    assert d["peak_hop"] == PEAK_HOP
    assert d["band_hop"] == BAND_HOP
    assert d["stft_window"] == STFT_WINDOW
    assert d["n_bands"] == N_BANDS
    assert d["band_edges"] == pytest.approx(BAND_EDGES)
    assert d["duration"] == pytest.approx(2.0, abs=0.05)
    n_samples = d["duration"] * SAMPLE_RATE
    assert len(d["peaks"]) == pytest.approx(n_samples / PEAK_HOP, abs=2)
    assert d["bands"].shape[0] == pytest.approx(n_samples / BAND_HOP, abs=8)
    assert d["bands"].shape[1] == N_BANDS


def test_missing_file_raises():
    with pytest.raises(RuntimeError, match="ffmpeg"):
        generate_blob(str(FIXTURES / "does_not_exist.wav"))


# ------------------------------------------------------------------ endpoint


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(waveforms_router.router, prefix="/api/waveforms")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _seed_waveform(db, track, blob):
    db.add(
        models.Waveform(
            track_id=track.id,
            sample_rate=SAMPLE_RATE,
            duration=2.0,
            samples_per_peak=PEAK_HOP,
            data_blob=blob,
        )
    )
    db.commit()


def test_endpoint_serves_blob_with_immutable_caching(db, client, make_track):
    track = make_track()
    blob = generate_blob(str(FIXTURES / "tone_8khz.wav"))
    _seed_waveform(db, track, blob)

    r = client.get(f"/api/waveforms/{track.id}/data")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert "immutable" in r.headers["cache-control"]
    assert r.content == blob
    assert decode_blob(r.content)["version"] == FORMAT_VERSION

    # ETag round-trip → 304.
    etag = r.headers["etag"]
    r2 = client.get(f"/api/waveforms/{track.id}/data", headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_endpoint_404s(db, client, make_track):
    r = client.get("/api/waveforms/99999/data")
    assert r.status_code == 404
    assert "Track not found" in r.json()["detail"]

    track = make_track()  # track exists, blob not generated yet
    r = client.get(f"/api/waveforms/{track.id}/data")
    assert r.status_code == 404
    assert "not ready" in r.json()["detail"]

    # Waveform row exists but predates v2 (data_blob NULL) → still "not ready".
    _seed_waveform(db, track, None)
    r = client.get(f"/api/waveforms/{track.id}/data")
    assert r.status_code == 404
    assert "not ready" in r.json()["detail"]

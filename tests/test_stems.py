"""Stem splitting pipeline unit tests (#194).

The demucs subprocess itself is not run here (heavy, model download); it is
exercised by the real-track verification recorded on the issue. These tests
cover everything around it: the meta.json currency marker, the ffmpeg
decode/encode legs, the alignment gate (the AAC encoder-delay verification
from #149, on synthetic audio), and import hygiene (backend.stems must never
pull torch/demucs into the app process).
"""

import subprocess
import sys
from pathlib import Path

import numpy as np

from backend.config import StemsConfig
from backend.stems import (
    BITRATE,
    CODEC,
    META_FILENAME,
    SAMPLE_RATE,
    STEMS_VERSION,
    StemsMeta,
    alignment_offset,
    decode_mono_f32,
    decode_to_wav,
    encode_stem,
    read_meta,
    reconstruction_snr_db,
    stems_dir,
)


def _write_wav(path: Path, samples: np.ndarray, channels: int = 1) -> None:
    """Write float32 samples to a wav via ffmpeg (no soundfile dependency)."""
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", str(channels),
            "-i", "-", "-c:a", "pcm_f32le", str(path),
        ],
        input=samples.astype(np.float32).tobytes(),
        capture_output=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr.decode()


def _test_signal(seconds: float = 6.0, seed: int = 7) -> np.ndarray:
    """Noise bursts over silence: sharply correlatable, codec-survivable."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    burst = int(0.05 * SAMPLE_RATE)
    for start in range(SAMPLE_RATE // 2, n - burst, SAMPLE_RATE // 2):
        sig[start : start + burst] = rng.standard_normal(burst) * 0.5
    return sig


# --- meta.json ----------------------------------------------------------------


def _meta(**overrides) -> StemsMeta:
    base = {
        "model": "htdemucs",
        "stems_version": STEMS_VERSION,
        "codec": CODEC,
        "bitrate": BITRATE,
        "sample_rate": SAMPLE_RATE,
        "source_mtime_ns": 123456789,
        "source_size": 1024,
    }
    base.update(overrides)
    return StemsMeta(**base)


def test_meta_round_trip(tmp_path: Path) -> None:
    config = StemsConfig(directory=str(tmp_path))
    d = stems_dir(42, config)
    d.mkdir(parents=True)
    (d / META_FILENAME).write_text(_meta().to_json())
    assert read_meta(42, config) == _meta()


def test_meta_absent_or_corrupt_reads_none(tmp_path: Path) -> None:
    config = StemsConfig(directory=str(tmp_path))
    assert read_meta(1, config) is None  # no dir at all
    d = stems_dir(2, config)
    d.mkdir(parents=True)
    (d / META_FILENAME).write_text("{not json")
    assert read_meta(2, config) is None
    (d / META_FILENAME).write_text('{"model": "htdemucs"}')  # missing fields
    assert read_meta(2, config) is None


def test_meta_carries_all_currency_fields() -> None:
    # The #149 currency check needs model + version + source identity.
    fields = set(StemsMeta.__dataclass_fields__)
    assert {"model", "stems_version", "source_mtime_ns", "source_size"} <= fields


# --- ffmpeg legs + alignment gate ----------------------------------------------


def test_decode_to_wav_is_stereo_44k(tmp_path: Path) -> None:
    mono = _test_signal(2.0)
    src = tmp_path / "src.wav"
    _write_wav(src, mono)
    out = tmp_path / "out.wav"
    decode_to_wav(src, out)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=channels,sample_rate",
         "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=False,
    )
    assert probe.stdout.strip() in ("44100,2", "2,44100")


def test_alignment_gate_aac_zero_offset(tmp_path: Path) -> None:
    """The alignment gate (#149): AAC encode->decode must not shift samples."""
    sig = _test_signal()
    ref_wav = tmp_path / "ref.wav"
    _write_wav(ref_wav, sig)
    m4a = tmp_path / "stem.m4a"
    encode_stem(ref_wav, m4a)
    decoded = decode_mono_f32(m4a)
    assert alignment_offset(sig, decoded) == 0


def test_alignment_offset_detects_injected_shift() -> None:
    """The gate can actually see an offset (it isn't vacuously zero)."""
    sig = _test_signal()
    shift = 1105  # the demucs sphn mp3 offset from the benchmark
    shifted = np.concatenate([np.zeros(shift, dtype=np.float32), sig])
    assert alignment_offset(sig, shifted) == shift


def test_reconstruction_snr_sanity() -> None:
    sig = _test_signal()
    assert reconstruction_snr_db(sig, sig) == float("inf")
    noisy = sig + np.random.default_rng(0).standard_normal(len(sig)).astype(np.float32) * 1e-3
    snr = reconstruction_snr_db(sig, noisy)
    assert 20 < snr < 80


# --- import hygiene -------------------------------------------------------------


def test_backend_stems_never_imports_torch_or_demucs() -> None:
    """demucs/torch live in the split subprocess only (#149)."""
    code = (
        "import sys; import backend.stems; "
        "bad = [m for m in ('torch', 'demucs', 'torchaudio') if m in sys.modules]; "
        "sys.exit(1 if bad else 0)"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, check=False)
    assert proc.returncode == 0, proc.stderr.decode()

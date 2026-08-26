"""Stem splitting pipeline (stems map #118; decisions #148/#149, build #194).

Splits a Track's audio into 4 stems (vocals/drums/bass/other) and stores them
as AAC-256 m4a under `<stems dir>/<track_id>/` next to a `meta.json` currency
marker. The filesystem is the source of truth — there are no DB rows for
stems; `meta.json` written last marks a complete, valid split.

Invariants (hard-won, do not relax casually):

- **Decode via our own ffmpeg**, never demucs' input decode: demucs 4.1.0's
  sphn mp3 decode is offset ~25 ms vs ffmpeg, which would misalign stems with
  our beatgrids/waveforms (docs/research/stem-splitting-model-benchmark.md).
- **`--float32 --clip-mode none`**: with defaults demucs rescales stems on
  loud masters (per-stem gain up to -30%) and they no longer sum back to the
  mixture. Performance stems must sum to the original with all stems on;
  headroom is our gain stage's problem.
- **demucs/torch never enter this process.** They live in the `stems`
  dependency group and run in a subprocess. This module must not import them
  (tests enforce it).

The alignment gate (AAC encoder-delay verification) lives in
`alignment_offset`; tests/test_stems.py exercises it on synthetic audio, and
the codec decision (#149) says: if AAC ever fails the gate, Opus is the
designated fallback.
"""

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend.config import StemsConfig, get_config

logger = logging.getLogger(__name__)

STEMS_VERSION = 1
"""Pipeline version: bump on codec/flag/layout changes to invalidate the cache."""

STEM_NAMES = ("vocals", "drums", "bass", "other")
SAMPLE_RATE = 44100
CODEC = "aac"
BITRATE = "256k"
META_FILENAME = "meta.json"

# Alignment gate tolerance: zero samples. The whole point of the gate.
_ALIGNMENT_SEARCH = 8192  # samples searched either side of zero


@dataclass(frozen=True)
class StemsMeta:
    """The currency marker stored beside the stems (meta.json)."""

    model: str
    stems_version: int
    codec: str
    bitrate: str
    sample_rate: int
    source_mtime_ns: int
    source_size: int

    def to_json(self) -> str:
        return json.dumps(self.__dict__, indent=2)

    @classmethod
    def from_json(cls, text: str) -> "StemsMeta":
        data = json.loads(text)
        return cls(**{k: data[k] for k in cls.__dataclass_fields__})


def stems_dir(track_id: int, config: StemsConfig | None = None) -> Path:
    config = config or get_config().stems
    return Path(config.directory) / str(track_id)


def read_meta(track_id: int, config: StemsConfig | None = None) -> StemsMeta | None:
    """The track's meta.json, or None if absent/unreadable (= no valid stems)."""
    path = stems_dir(track_id, config) / META_FILENAME
    try:
        return StemsMeta.from_json(path.read_text())
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _source_identity(source: Path) -> tuple[int, int]:
    st = source.stat()
    return st.st_mtime_ns, st.st_size


def _run(cmd: list[str], **kwargs) -> None:
    """Run a subprocess, raising with its stderr tail on failure."""
    proc = subprocess.run(cmd, capture_output=True, check=False, **kwargs)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-2000:]
        raise RuntimeError(f"{cmd[0]} failed ({proc.returncode}): {tail}")


def decode_to_wav(source: Path, dest: Path) -> None:
    """Decode any library file to stereo float32 wav at 44.1k via our ffmpeg.

    This is the canonical decode stems align to (same ffmpeg lineage as
    waveform_data.analyze, but stereo).
    """
    _run([
        "ffmpeg", "-v", "error", "-y", "-i", str(source),
        "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_f32le",
        str(dest),
    ])


def _demucs_command(input_wav: Path, out_dir: Path, config: StemsConfig) -> list[str]:
    # sys.executable is the project venv's python; demucs is present because
    # `stems` is a default dependency group (pyproject [tool.uv]).
    return [
        sys.executable, "-m", "demucs.separate",
        "-d", config.device,
        "-n", config.model,
        "--float32", "--clip-mode", "none",
        "-o", str(out_dir),
        "--filename", "{stem}.{ext}",
        str(input_wav),
    ]


def encode_stem(wav: Path, dest_m4a: Path) -> None:
    """Encode a stem wav to AAC-256 m4a (ffmpeg native encoder)."""
    _run([
        "ffmpeg", "-v", "error", "-y", "-i", str(wav),
        "-c:a", CODEC, "-b:a", BITRATE, "-movflags", "+faststart",
        str(dest_m4a),
    ])


def split_track(track_id: int, source: Path, config: StemsConfig | None = None) -> Path:
    """Run the full pipeline for one track; returns the stems dir.

    decode (our ffmpeg, stereo f32 wav) -> demucs subprocess -> AAC-256 m4a
    encode -> meta.json (written last: its presence marks a valid split).
    Any existing stems dir for the track is replaced.
    """
    config = config or get_config().stems
    source = Path(source)
    mtime_ns, size = _source_identity(source)

    dest = stems_dir(track_id, config)
    with tempfile.TemporaryDirectory(prefix=f"stems-{track_id}-") as tmp:
        tmp_path = Path(tmp)
        input_wav = tmp_path / "input.wav"
        decode_to_wav(source, input_wav)

        demucs_out = tmp_path / "out"
        env = dict(os.environ, PYTORCH_ENABLE_MPS_FALLBACK="1")
        _run(_demucs_command(input_wav, demucs_out, config), env=env)
        stem_wavs = demucs_out / config.model
        missing = [s for s in STEM_NAMES if not (stem_wavs / f"{s}.wav").exists()]
        if missing:
            raise RuntimeError(f"demucs produced no {missing} for track {track_id}")

        staging = tmp_path / "stems"
        staging.mkdir()
        for stem in STEM_NAMES:
            encode_stem(stem_wavs / f"{stem}.wav", staging / f"{stem}.m4a")

        meta = StemsMeta(
            model=config.model,
            stems_version=STEMS_VERSION,
            codec=CODEC,
            bitrate=BITRATE,
            sample_rate=SAMPLE_RATE,
            source_mtime_ns=mtime_ns,
            source_size=size,
        )
        (staging / META_FILENAME).write_text(meta.to_json())

        # Replace-in-place: clear any stale dir, then move the staging dir in.
        if dest.exists():
            shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging), str(dest))
    logger.info("split track %s -> %s", track_id, dest)
    return dest


# --- Alignment gate -----------------------------------------------------------


def decode_mono_f32(path: Path, seconds: float | None = None) -> np.ndarray:
    """Decode any audio file to mono float32 at 44.1k (for analysis only)."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path)]
    if seconds is not None:
        cmd += ["-t", f"{seconds}"]
    cmd += ["-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-2000:]
        raise RuntimeError(f"ffmpeg decode failed: {tail}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def alignment_offset(reference: np.ndarray, candidate: np.ndarray) -> int:
    """Sample offset of `candidate` relative to `reference` (0 = aligned).

    Cross-correlates a window from the middle of the reference against the
    candidate over +/-_ALIGNMENT_SEARCH samples. Positive result means the
    candidate is late (content shifted right) by that many samples.
    """
    n = min(len(reference), len(candidate))
    if n < 4 * _ALIGNMENT_SEARCH:
        raise ValueError("signals too short for alignment measurement")
    win = min(SAMPLE_RATE * 10, n - 2 * _ALIGNMENT_SEARCH)
    start = (n - win) // 2
    ref_seg = reference[start : start + win]
    lo = start - _ALIGNMENT_SEARCH
    cand_seg = candidate[lo : start + win + _ALIGNMENT_SEARCH]
    corr = np.correlate(cand_seg, ref_seg, mode="valid")
    return int(np.argmax(corr)) - _ALIGNMENT_SEARCH


def reconstruction_snr_db(mixture: np.ndarray, stem_sum: np.ndarray) -> float:
    """SNR of the summed stems against the mixture (sanity: ~28-30 dB expected)."""
    n = min(len(mixture), len(stem_sum))
    mix, total = mixture[:n], stem_sum[:n]
    noise = mix - total
    power = float(np.mean(mix**2))
    noise_power = float(np.mean(noise**2))
    if noise_power == 0:
        return float("inf")
    return 10 * float(np.log10(power / noise_power))

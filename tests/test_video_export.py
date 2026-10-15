"""Video export job (#377): frames + WAV → MP4 through ffmpeg."""

import shutil
import struct
import subprocess

import pytest
from pathlib import Path

from backend import video_export


def _wav(seconds: float, rate: int = 8000) -> bytes:
    frames = int(seconds * rate)
    data = b"\x00\x00" * frames * 2
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 2, rate, rate * 4, 4, 16)
    header += b"data" + struct.pack("<I", len(data))
    return header + data


def _jpeg(ffmpeg: str, color: str) -> bytes:
    return subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s=64x112", "-frames:v", "1",
         "-f", "image2", "-vcodec", "mjpeg", "pipe:1"],
        check=True, capture_output=True,
    ).stdout


def test_slug():
    assert video_export.slug("ENERGY (I Feel) → Voices") == "ENERGY-I-Feel-Voices"
    assert video_export.slug("///") == "routine"


def test_mux_args_shape():
    args = video_export.ffmpeg_mux_args("ffmpeg", Path("/tmp/a.wav"), Path("/tmp/o.mp4"), 30)
    assert args[:1] == ["ffmpeg"]
    assert "image2pipe" in args and "pipe:0" in args and "libx264" in args and "yuv420p" in args
    assert args[-1] == "/tmp/o.mp4"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_job_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("MANADJ_DATA_DIR", str(tmp_path))
    ffmpeg = shutil.which("ffmpeg")
    job = video_export.start_job(_wav(0.5), name="t/est clip", fps=10, width=64, height=112)
    frames = b"".join(_jpeg(ffmpeg, c) for c in ("red", "green", "blue", "red", "green"))
    video_export.write_frames(job, frames, 5)
    spec = video_export.write_spec(job, b'{"fps": 10}')
    with pytest.raises(video_export.VideoExportError):
        video_export.write_spec(job, b"[1]")
    out = video_export.finish_job(job)
    assert spec == out.with_suffix(".clip.json") and spec.read_text().startswith("{")
    assert out.exists() and out.parent == tmp_path / "exports"
    assert out.name.startswith("t-est-clip-")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(out)],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    assert sorted(probe) == ["aac", "h264"]
    assert not job.workdir.exists()
    with pytest.raises(video_export.VideoExportError):
        video_export.get_job(job.id)

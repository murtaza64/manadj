"""Video export jobs (#377): mux a frame stream + a WAV into an MP4.

The frontend renders the Routine offline (audio through the real Mixer
DSP on an OfflineAudioContext, frames on a canvas at exact instants) and
streams the result here: `start` takes the WAV and spawns ffmpeg reading
JPEG frames from stdin (image2pipe); `write` appends frames; `finish`
closes stdin and waits. Outputs land under `<data root>/exports/`.

One process per job; jobs are in-memory (a restart orphans them — the
temp dir is per job and cleaned on finish/abort).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid as uuid_mod
from dataclasses import dataclass, field
from pathlib import Path

from .data_root import data_root


def exports_dir() -> Path:
    return data_root() / "exports"


class VideoExportError(Exception):
    pass


_SLUG_RE = re.compile(r"[^A-Za-z0-9._-]+")


def slug(name: str, fallback: str = "routine") -> str:
    s = _SLUG_RE.sub("-", name).strip("-.")
    return s[:80] or fallback


@dataclass
class VideoExportJob:
    id: str
    workdir: Path
    output: Path
    fps: int
    width: int
    height: int
    process: subprocess.Popen[bytes]
    frames: int = 0
    bytes_written: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)
    done: bool = False
    error: str | None = None


_jobs: dict[str, VideoExportJob] = {}


def ffmpeg_binary() -> str:
    found = shutil.which("ffmpeg")
    if not found:
        raise VideoExportError("ffmpeg not found on PATH")
    return found


def ffmpeg_mux_args(
    ffmpeg: str, audio_wav: Path, output: Path, fps: int, crf: int = 18
) -> list[str]:
    """ffmpeg command: MJPEG frames on stdin + WAV → H.264/AAC MP4.

    yuv420p + faststart for phone players; `-shortest` trims the video to
    the audio (frames are produced for exactly the rendered range, so the
    two already agree — this only guards a dropped final frame).
    """
    return [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-framerate", str(fps), "-vcodec", "mjpeg", "-i", "pipe:0",
        "-i", str(audio_wav),
        "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
        "-pix_fmt", "yuv420p", "-r", str(fps),
        "-c:a", "aac", "-b:a", "256k",
        "-movflags", "+faststart", "-shortest",
        str(output),
    ]


def start_job(audio_wav_bytes: bytes, *, name: str, fps: int, width: int, height: int) -> VideoExportJob:
    ffmpeg = ffmpeg_binary()
    out_dir = exports_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    job_id = uuid_mod.uuid4().hex[:12]
    workdir = Path(tempfile.mkdtemp(prefix=f"manadj-video-{job_id}-"))
    wav = workdir / "audio.wav"
    wav.write_bytes(audio_wav_bytes)
    output = out_dir / f"{slug(name)}-{job_id}.mp4"
    process = subprocess.Popen(
        ffmpeg_mux_args(ffmpeg, wav, output, fps),
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    job = VideoExportJob(
        id=job_id, workdir=workdir, output=output, fps=fps, width=width, height=height, process=process
    )
    _jobs[job_id] = job
    return job


def get_job(job_id: str) -> VideoExportJob:
    job = _jobs.get(job_id)
    if job is None:
        raise VideoExportError(f"unknown video export job {job_id}")
    return job


def write_frames(job: VideoExportJob, data: bytes, frame_count: int) -> None:
    with job.lock:
        if job.done:
            raise VideoExportError("job already finished")
        stdin = job.process.stdin
        assert stdin is not None
        try:
            stdin.write(data)
        except BrokenPipeError as exc:
            job.error = _stderr_tail(job)
            raise VideoExportError(f"ffmpeg closed the pipe: {job.error}") from exc
        job.frames += frame_count
        job.bytes_written += len(data)


def _stderr_tail(job: VideoExportJob) -> str:
    try:
        err = job.process.stderr.read() if job.process.stderr else b""
    except Exception:  # noqa: BLE001
        err = b""
    return err.decode("utf-8", "replace")[-2000:]


def finish_job(job: VideoExportJob) -> Path:
    with job.lock:
        if job.done:
            return job.output
        job.done = True
        stdin = job.process.stdin
        assert stdin is not None
        try:
            stdin.close()
        except BrokenPipeError:
            pass
        code = job.process.wait()
        err = _stderr_tail(job)
        shutil.rmtree(job.workdir, ignore_errors=True)
        _jobs.pop(job.id, None)
        if code != 0 or not job.output.exists():
            raise VideoExportError(f"ffmpeg exited {code}: {err}")
        return job.output


def abort_job(job: VideoExportJob) -> None:
    with job.lock:
        job.done = True
        try:
            job.process.kill()
        except Exception:  # noqa: BLE001
            pass
        shutil.rmtree(job.workdir, ignore_errors=True)
        if job.output.exists():
            os.unlink(job.output)
        _jobs.pop(job.id, None)


# ── Session span → promotion preview (clip editor source) ───────────────


def session_span_preview(db, session_uuid: str, start_s: float, end_s: float):
    """Derive a cast from the Session's audibility inside [start_s, end_s]
    (entry order = first audible instant) and run the same promotion
    preview a candidate gets. Lets the clip editor cut an arbitrary span
    without minting anything. Raises VideoExportError with the promotion's
    reason (e.g. scratch motion) when the span cannot be promoted."""
    import json as _json

    from backend import models
    from backend.routine_miner import reconstruct_audibility
    from backend.routine_preview import PreviewError, build_promotion_preview

    s = db.query(models.Session).filter(models.Session.uuid == session_uuid).first()
    if s is None:
        raise VideoExportError("session not found")
    events: list[dict] = []
    for chunk in s.chunks:
        events.extend(_json.loads(chunk.events_json))
    events.sort(key=lambda e: e.get("t", 0))
    intervals, _ = reconstruct_audibility(events)
    first: dict[int, float] = {}
    for iv in intervals:
        a = max(iv.start, start_s)
        b = min(iv.end, end_s)
        if b - a <= 0.25:
            continue
        first[iv.track_id] = min(first.get(iv.track_id, a), a)
    cast = sorted(first, key=lambda tid: first[tid])
    if len(cast) < 3:
        raise VideoExportError(
            f"span has {len(cast)} audible track(s); a clip source needs a Routine-shaped span (≥ 3)"
        )
    offsets = [first[tid] - start_s for tid in cast]
    offsets[0] = 0.0
    try:
        return cast, build_promotion_preview(db, session_uuid, cast, start_s, end_s, offsets)
    except PreviewError as e:
        raise VideoExportError(str(e)) from e

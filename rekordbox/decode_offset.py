"""Decode-frame offsets between manadj's timeline and Rekordbox's.

manadj positions live in the ffmpeg decode frame (waveform_data.py);
Rekordbox decodes lossy containers with different priming-trim rules, so
the same audio event sits at different millisecond positions in the two
timelines. The per-class offsets were measured in the
rekordbox-performance-write spike (exp F/G: RB's own beatgrids on
same-content transcodes, 466 beats, 1 ms spread — see
docs/research/rekordbox-performance-write.md):

    RB_ms = manadj_ms + offset(class)

Class is a property of the FILE (container + encoder metadata), sniffed
from bytes — no audio decoding:

- mp3: presence of a Xing/Info header, and of a LAME encoder tag behind
  it. Rekordbox ignores LAME CRC validity (spike: case C == case D).
- m4a: presence of an iTunSMPB gapless atom (iTunes/CoreAudio encoders)
  vs none (ffmpeg/Lavf).
- lossless (flac/wav/aiff/...): both frames agree; offset 0.
"""

from __future__ import annotations

import logging
import mmap
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)


class ContainerClass(str, Enum):
    LOSSLESS = "lossless"
    MP3_NO_XING = "mp3-no-xing"
    MP3_XING_ONLY = "mp3-xing-only"
    MP3_LAME = "mp3-lame"
    M4A_PLAIN = "m4a-plain"
    M4A_SMPB = "m4a-smpb"


EXPORT_OFFSET_MS: dict[ContainerClass, int] = {
    ContainerClass.LOSSLESS: 0,
    ContainerClass.MP3_NO_XING: -2,
    ContainerClass.MP3_XING_ONLY: 23,
    ContainerClass.MP3_LAME: 49,
    ContainerClass.M4A_PLAIN: 23,
    ContainerClass.M4A_SMPB: 48,
}

# (path, mtime) -> class; header sniffing is cheap but sync status reads
# whole libraries per request.
_cache: dict[tuple[str, float], ContainerClass] = {}


def classify(path: str | Path) -> ContainerClass:
    """Container class of an audio file. Unreadable/odd files fall back
    to LOSSLESS (offset 0) — a wrong offset is worse than none."""
    p = Path(path)
    try:
        key = (str(p), p.stat().st_mtime)
    except OSError:
        return ContainerClass.LOSSLESS
    hit = _cache.get(key)
    if hit is not None:
        return hit
    try:
        result = _classify_uncached(p)
    except Exception as e:  # noqa: BLE001 - never let sniffing break sync
        logger.warning("decode_offset: could not classify %s: %s", p, e)
        result = ContainerClass.LOSSLESS
    _cache[key] = result
    return result


def export_offset_ms(path: str | Path) -> int:
    """Milliseconds to ADD to a manadj position to land in Rekordbox's
    frame (subtract to come back)."""
    return EXPORT_OFFSET_MS[classify(path)]


def rb_ms_to_manadj_seconds(ms: int, path: str | Path) -> float:
    return (ms - export_offset_ms(path)) / 1000.0


def manadj_seconds_to_rb_ms(seconds: float, path: str | Path) -> int:
    return int(round(seconds * 1000)) + export_offset_ms(path)


# -- sniffing ----------------------------------------------------------------


def _classify_uncached(p: Path) -> ContainerClass:
    suffix = p.suffix.lower()
    if suffix == ".mp3":
        with open(p, "rb") as f:
            # ID3 tags (cover art) run to hundreds of KB: seek past the
            # tag chain first, then read a frame-sized window.
            off = 0
            while True:
                f.seek(off)
                hdr = f.read(10)
                if hdr[:3] != b"ID3" or len(hdr) < 10:
                    break
                size = 0
                for b in hdr[6:10]:  # synchsafe
                    size = (size << 7) | (b & 0x7F)
                off += 10 + size
            f.seek(off)
            return _classify_mp3(f.read(64 * 1024))
    if suffix in (".m4a", ".mp4", ".aac"):
        return _classify_m4a(p)
    return ContainerClass.LOSSLESS


def _classify_mp3(head: bytes) -> ContainerClass:
    """`head` starts at the end of the ID3v2 tag chain (or file start)."""
    frame = _find_frame_sync(head, 0)
    if frame is None:
        return ContainerClass.MP3_NO_XING
    xing = _xing_offset(head, frame)
    if xing is None or head[xing : xing + 4] not in (b"Xing", b"Info"):
        return ContainerClass.MP3_NO_XING
    # Xing: 4 magic + 4 flags, then optional frames/bytes/TOC/quality per
    # flag bits; the encoder string (LAME tag start) follows.
    flags = int.from_bytes(head[xing + 4 : xing + 8], "big")
    enc = xing + 8
    enc += 4 if flags & 0x1 else 0  # frame count
    enc += 4 if flags & 0x2 else 0  # byte count
    enc += 100 if flags & 0x4 else 0  # TOC
    enc += 4 if flags & 0x8 else 0  # VBR quality
    if head[enc : enc + 4] == b"LAME":
        return ContainerClass.MP3_LAME
    return ContainerClass.MP3_XING_ONLY


def _find_frame_sync(head: bytes, start: int) -> int | None:
    """First PLAUSIBLE MPEG audio frame header. A bare 0xFFEx scan false-
    positives inside cover art / tag padding, so validate the header
    fields (version/layer/bitrate/samplerate not reserved)."""
    i = start
    while i + 4 <= len(head):
        if head[i] == 0xFF and (head[i + 1] & 0xE0) == 0xE0:
            b1, b2 = head[i + 1], head[i + 2]
            version_ok = (b1 >> 3) & 0x3 != 0x1  # 01 reserved
            layer_ok = (b1 >> 1) & 0x3 != 0x0  # 00 reserved
            bitrate_ok = (b2 >> 4) & 0xF not in (0x0, 0xF)  # free/bad
            samplerate_ok = (b2 >> 2) & 0x3 != 0x3  # reserved
            if version_ok and layer_ok and bitrate_ok and samplerate_ok:
                return i
        i += 1
    return None


def _xing_offset(head: bytes, frame: int) -> int | None:
    """Offset of the Xing/Info marker inside the first frame: header (4)
    plus the side-info block, whose size depends on MPEG version and
    channel mode."""
    if frame + 4 > len(head):
        return None
    b1, b3 = head[frame + 1], head[frame + 3]
    version_bits = (b1 >> 3) & 0x3  # 3 = MPEG1
    mono = ((b3 >> 6) & 0x3) == 0x3
    if version_bits == 0x3:  # MPEG1
        side = 17 if mono else 32
    else:  # MPEG2 / 2.5
        side = 9 if mono else 17
    return frame + 4 + side


def _classify_m4a(p: Path) -> ContainerClass:
    """iTunSMPB lives in the moov.udta.meta.ilst atom; the atom name
    appears literally, and moov sits near the start or end of the file —
    scan both."""
    window = 4 * 1024 * 1024
    size = p.stat().st_size
    with open(p, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        if mm.find(b"iTunSMPB", 0, min(window, size)) != -1:
            return ContainerClass.M4A_SMPB
        if size > window and mm.find(b"iTunSMPB", max(0, size - window)) != -1:
            return ContainerClass.M4A_SMPB
    return ContainerClass.M4A_PLAIN

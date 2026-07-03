"""File facts: Track fields derived from the audio file itself.

Owns codec/bitrate/filesize/duration (facts of the stream and the file on
disk, not tags). Write paths: Disk Import for new tracks, the backfill
script for existing ones, and Replace Audio when it lands. No periodic
recompute — out-of-band file edits are handled by re-running the backfill
with force=True.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

from mutagen import File as MutagenFile  # type: ignore[attr-defined]
from sqlalchemy.orm import Session

from ..models import Track
from .file_metadata import FileMetadataError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FileFacts:
    codec: str
    bitrate_kbps: int | None
    filesize_bytes: int
    duration_secs: float | None


def _codec(audio: object) -> str:
    """Codec name from the mutagen file type / stream info."""
    name = type(audio).__name__.lower()
    if name == "mp3":
        return "mp3"
    if name == "mp4":
        # AAC unless the stream says ALAC
        info_codec = str(getattr(getattr(audio, "info", None), "codec", "") or "")
        return "alac" if info_codec.startswith("alac") else "aac"
    if name == "flac":
        return "flac"
    if name == "wave":
        return "pcm"
    return name


def read_file_facts(path: str | Path) -> FileFacts:
    """Codec, bitrate, filesize, and duration of an audio file."""
    path = Path(path)
    if not path.exists():
        raise FileMetadataError(f"file not found: {path}")
    try:
        audio = MutagenFile(str(path))
        if audio is None or audio.info is None:
            raise FileMetadataError(f"unsupported or corrupt audio file: {path}")
    except FileMetadataError:
        raise
    except Exception as e:
        raise FileMetadataError(f"cannot read {path}: {e}") from e
    bitrate = getattr(audio.info, "bitrate", 0) or 0
    return FileFacts(
        codec=_codec(audio),
        bitrate_kbps=round(bitrate / 1000) or None,
        filesize_bytes=path.stat().st_size,
        duration_secs=audio.info.length or None,
    )


def refresh_file_facts(db: Session, force: bool = False) -> int:
    """Fill file-derived fields for Tracks missing any of them.

    force=True recomputes every Track (for out-of-band file edits).
    """
    query = db.query(Track)
    if not force:
        query = query.filter(
            (Track.codec.is_(None))
            | (Track.bitrate_kbps.is_(None))
            | (Track.filesize_bytes.is_(None))
            | (Track.duration_secs.is_(None))
        )
    updated = 0
    for track in query.all():
        try:
            facts = read_file_facts(str(track.filename))
        except FileMetadataError:
            continue
        # ignore[assignment] noise below: legacy Column-style Track model
        track.codec = facts.codec  # type: ignore[assignment]
        track.bitrate_kbps = facts.bitrate_kbps  # type: ignore[assignment]
        track.filesize_bytes = facts.filesize_bytes  # type: ignore[assignment]
        track.duration_secs = facts.duration_secs  # type: ignore[assignment]
        updated += 1
    db.commit()
    if updated:
        logger.info("refreshed file facts for %d tracks", updated)
    return updated

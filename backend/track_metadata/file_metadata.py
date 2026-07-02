"""Read and write track metadata in audio files.

Formats: mp3 / m4a / flac via mutagen's "easy" tag interface, wav via raw ID3
frames (mutagen has no easy wrapper for WAVE). Key crosses this interface as
an Engine DJ key ID; files store musical notation (`initialkey` / TKEY).

Errors raise FileMetadataError — never silently swallowed (ADR-0002 posture:
the silent `except: pass` in the old id3_utils hid a dead key-write for
months).
"""

from pathlib import Path

from mutagen import File as MutagenFile  # type: ignore[attr-defined]
from mutagen.easyid3 import EasyID3
from mutagen.easymp4 import EasyMP4Tags
from mutagen.id3 import TBPM, TIT2, TKEY, TPE1  # type: ignore[attr-defined]
from mutagen.wave import WAVE
from pydantic import BaseModel

from backend.key import Key

# mutagen's "easy" vocabularies don't include initialkey out of the box.
EasyID3.RegisterTextKey("initialkey", "TKEY")  # type: ignore[no-untyped-call]
EasyMP4Tags.RegisterFreeformKey("initialkey", "initialkey")  # type: ignore[no-untyped-call]


class FileMetadataError(Exception):
    """The file could not be read or written."""


class FileMetadata(BaseModel):
    """Metadata read from an audio file. key: Engine DJ ID; bpm: float BPM."""

    title: str | None = None
    artist: str | None = None
    key: int | None = None
    bpm: float | None = None


def read_file_metadata(path: str | Path) -> FileMetadata:
    """Read title/artist/key/bpm from an audio file.

    Untagged fields come back None; an unreadable or missing file raises
    FileMetadataError.
    """
    path = Path(path)
    if not path.exists():
        raise FileMetadataError(f"file not found: {path}")
    try:
        if path.suffix.lower() == ".wav":
            return _read_wav(path)
        return _read_easy(path)
    except FileMetadataError:
        raise
    except Exception as e:
        raise FileMetadataError(f"cannot read metadata from {path}: {e}") from e


def write_file_metadata(
    path: str | Path,
    *,
    title: str | None = None,
    artist: str | None = None,
    key: int | None = None,
    bpm: float | None = None,
) -> None:
    """Write the given fields to an audio file. None fields are left untouched.

    Raises FileMetadataError if the file can't be written, ValueError for an
    invalid key ID.
    """
    path = Path(path)
    key_obj = None
    if key is not None:
        key_obj = Key.from_engine_id(key)
        if key_obj is None:
            raise ValueError(f"invalid Engine DJ key ID: {key}")
    if not path.exists():
        raise FileMetadataError(f"file not found: {path}")
    try:
        if path.suffix.lower() == ".wav":
            _write_wav(path, title, artist, key_obj, bpm)
        else:
            _write_easy(path, title, artist, key_obj, bpm)
    except FileMetadataError:
        raise
    except Exception as e:
        raise FileMetadataError(f"cannot write metadata to {path}: {e}") from e


# --- easy interface (mp3 / m4a / flac) ---


def _read_easy(path: Path) -> FileMetadata:
    audio = MutagenFile(str(path), easy=True)
    if audio is None:
        raise FileMetadataError(f"unsupported or corrupt audio file: {path}")

    def first(tag: str) -> str | None:
        values = audio.tags.get(tag) if audio.tags else None
        if not values:
            return None
        value = values[0]
        if isinstance(value, bytes):  # MP4 freeform atoms read back as bytes
            value = value.decode("utf-8", errors="replace")
        return str(value)

    key_str = first("initialkey")
    key = Key.from_musical(key_str) if key_str else None
    bpm_str = first("bpm")
    try:
        bpm = float(bpm_str) if bpm_str else None
    except ValueError:
        bpm = None
    return FileMetadata(
        title=first("title"),
        artist=first("artist"),
        key=key.engine_id if key else None,
        bpm=bpm,
    )


def _write_easy(
    path: Path, title: str | None, artist: str | None, key: Key | None, bpm: float | None
) -> None:
    audio = MutagenFile(str(path), easy=True)
    if audio is None:
        raise FileMetadataError(f"unsupported or corrupt audio file: {path}")
    if audio.tags is None:
        audio.add_tags()
    if title is not None:
        audio["title"] = title
    if artist is not None:
        audio["artist"] = artist
    if key is not None:
        audio["initialkey"] = key.musical
    if bpm is not None:
        audio["bpm"] = str(round(bpm))
    audio.save()


# --- wav (raw ID3 frames) ---


def _read_wav(path: Path) -> FileMetadata:
    audio = WAVE(str(path))

    def frame_text(frame_id: str) -> str | None:
        frame = audio.tags.get(frame_id) if audio.tags else None
        if frame is None or not frame.text:
            return None
        return str(frame.text[0])

    key_str = frame_text("TKEY")
    key = Key.from_musical(key_str) if key_str else None
    bpm_str = frame_text("TBPM")
    try:
        bpm = float(bpm_str) if bpm_str else None
    except ValueError:
        bpm = None
    return FileMetadata(
        title=frame_text("TIT2"),
        artist=frame_text("TPE1"),
        key=key.engine_id if key else None,
        bpm=bpm,
    )


def _write_wav(
    path: Path, title: str | None, artist: str | None, key: Key | None, bpm: float | None
) -> None:
    audio = WAVE(str(path))
    if audio.tags is None:
        audio.add_tags()
    if title is not None:
        audio.tags["TIT2"] = TIT2(encoding=3, text=[title])
    if artist is not None:
        audio.tags["TPE1"] = TPE1(encoding=3, text=[artist])
    if key is not None:
        audio.tags["TKEY"] = TKEY(encoding=3, text=[key.musical])
    if bpm is not None:
        audio.tags["TBPM"] = TBPM(encoding=3, text=[str(round(bpm))])
    audio.save()

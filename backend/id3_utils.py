"""Utilities for extracting and writing ID3 metadata to/from audio files."""

from mutagen import File
from typing import Dict, Optional
from .key import Key


def extract_id3_metadata(filepath: str) -> Dict[str, Optional[str | int]]:
    """
    Extract ID3 metadata from an audio file.

    Supports MP3, FLAC, M4A, WAV, and other formats supported by mutagen.

    Args:
        filepath: Absolute path to the audio file

    Returns:
        Dictionary with keys: title, artist, key, bpm
        Key is returned as Engine DJ ID (0-23) or None
        Values are None if tags are missing or file cannot be read
    """
    try:
        audio = File(filepath, easy=True)
        if audio is None:
            return {
                "title": None,
                "artist": None,
                "key": None,
                "bpm": None
            }

        # Extract tags using easy interface
        # Tags are returned as lists, so we take the first element
        title = None
        artist = None
        key = None
        bpm = None

        if "title" in audio:
            title = audio["title"][0] if audio["title"] else None

        if "artist" in audio:
            artist = audio["artist"][0] if audio["artist"] else None

        # Key can be stored as "initialkey" in some formats
        # Convert to Engine DJ ID
        if "initialkey" in audio:
            key_str = audio["initialkey"][0] if audio["initialkey"] else None
            if key_str:
                key_obj = Key.from_musical(key_str)
                key = key_obj.engine_id if key_obj else None

        # BPM can be stored as "bpm" or "tempo"
        if "bpm" in audio:
            bpm_str = audio["bpm"][0] if audio["bpm"] else None
            if bpm_str:
                try:
                    bpm = int(float(bpm_str))  # Convert to int, handling floats
                except (ValueError, TypeError):
                    bpm = None

        return {
            "title": title,
            "artist": artist,
            "key": key,
            "bpm": bpm
        }

    except Exception as e:
        # Return empty metadata on any error (corrupted file, unsupported format, etc.)
        return {
            "title": None,
            "artist": None,
            "key": None,
            "bpm": None
        }


def write_id3_metadata(
    filepath: str,
    title: Optional[str] = None,
    artist: Optional[str] = None,
    key: Optional[int] = None,  # Engine DJ ID (0-23)
    bpm: Optional[float] = None
) -> bool:
    """
    Write ID3 metadata to an audio file.

    Args:
        filepath: Absolute path to the audio file
        title: Track title (None to skip)
        artist: Artist name (None to skip)
        key: Engine DJ key ID (0-23) (None to skip)
        bpm: BPM as float (None to skip)

    Returns:
        True if successful, False if error occurred
    """
    try:
        audio = File(filepath, easy=True)
        if audio is None:
            return False

        # Write title
        if title is not None:
            audio["title"] = title

        # Write artist
        if artist is not None:
            audio["artist"] = artist

        # Write key (convert from Engine DJ ID to musical notation)
        if key is not None:
            try:
                key_obj = Key(key)
                musical_key = key_obj.to_musical()
                audio["initialkey"] = musical_key
            except Exception:
                pass  # Skip if key conversion fails

        # Write BPM
        if bpm is not None:
            audio["bpm"] = str(int(bpm))

        # Save changes
        audio.save()
        return True

    except Exception as e:
        print(f"Error writing ID3 metadata to {filepath}: {e}")
        return False

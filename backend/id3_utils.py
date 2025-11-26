"""Utilities for extracting ID3 metadata from audio files."""

from mutagen import File
from typing import Dict, Optional


def extract_id3_metadata(filepath: str) -> Dict[str, Optional[str | int]]:
    """
    Extract ID3 metadata from an audio file.

    Supports MP3, FLAC, M4A, WAV, and other formats supported by mutagen.

    Args:
        filepath: Absolute path to the audio file

    Returns:
        Dictionary with keys: title, artist, key, bpm
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
        if "initialkey" in audio:
            key = audio["initialkey"][0] if audio["initialkey"] else None

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

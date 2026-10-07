"""Directory scanning utilities for library import."""

from pathlib import Path


AUDIO_EXTENSIONS = {'.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.aiff', '.aif', '.alac'}


def scan_directory(tracks_dir: Path, recursive: bool = False) -> list[Path]:
    """
    Scan directory for audio files.

    Args:
        tracks_dir: Directory to scan
        recursive: Whether to scan subdirectories

    Returns:
        List of audio file paths
    """
    # Match extensions case-insensitively on every OS (`*.mp3` globbing is
    # case-sensitive on POSIX, so `.MP3` files were skipped).
    entries = tracks_dir.rglob('*') if recursive else tracks_dir.iterdir()
    audio_files = [
        f for f in entries if f.suffix.lower() in AUDIO_EXTENSIONS and f.is_file()
    ]

    # Convert to absolute paths and sort
    audio_files = [f.resolve() for f in audio_files]
    audio_files.sort()

    return audio_files

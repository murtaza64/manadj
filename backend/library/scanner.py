"""Directory scanning utilities for library import."""

from pathlib import Path


AUDIO_EXTENSIONS = {'.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.aiff', '.alac'}


def scan_directory(tracks_dir: Path, recursive: bool = False) -> list[Path]:
    """
    Scan directory for audio files.

    Args:
        tracks_dir: Directory to scan
        recursive: Whether to scan subdirectories

    Returns:
        List of audio file paths
    """
    audio_files = []

    if recursive:
        # Recursive scan
        for ext in AUDIO_EXTENSIONS:
            audio_files.extend(tracks_dir.rglob(f'*{ext}'))
    else:
        # Single directory scan
        for ext in AUDIO_EXTENSIONS:
            audio_files.extend(tracks_dir.glob(f'*{ext}'))

    # Convert to absolute paths and sort
    audio_files = [f.resolve() for f in audio_files]
    audio_files.sort()

    return audio_files

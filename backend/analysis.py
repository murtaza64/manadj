"""Key detection using Essentia / keyfinder-cli.

Legacy BPM estimation was superseded by native grid Analysis (ADR 0024,
backend/grid_analysis.py); issue 08 replaces this key path with the
shootout-winning backend. Heavy import (essentia) at module scope — import
this module lazily, never from the app import chain.
"""

from datetime import datetime
import essentia.standard as es
import subprocess
import shutil
import os

from .key import Key
from .config import get_config


def _load_audio(audio_path: str, trim_seconds: float = 0) -> tuple:
    """Load audio via Essentia's MonoLoader (44.1k mono), optionally
    trimming the first/last trim_seconds."""
    loader = es.MonoLoader(filename=audio_path, sampleRate=44100)
    audio = loader()
    sample_rate = 44100

    if trim_seconds > 0:
        trim_samples = int(trim_seconds * sample_rate)
        total_samples = len(audio)

        # Only trim if we have enough audio
        if total_samples > (2 * trim_samples):
            audio = audio[trim_samples:-trim_samples]

    return audio, sample_rate


def _detect_key_essentia(audio_path: str) -> dict:
    """
    Detect musical key using Essentia KeyExtractor.

    Args:
        audio_path: Path to audio file

    Returns:
        dict with:
            - key: str (musical notation)
            - formats: dict (musical, openkey, camelot, engine_id)
            - confidence: float
            - metadata: {scale, analyzed_at}
    """
    audio, sample_rate = _load_audio(audio_path, trim_seconds=0)

    key_extractor = es.KeyExtractor()
    key, scale, strength = key_extractor(audio)

    # Convert to musical notation format (e.g., "C", "Am", "F#")
    # Essentia returns key like "C" and scale like "major" or "minor"
    if scale.lower() == 'minor':
        musical_key = f"{key}m"
    else:
        musical_key = key

    # Convert to multiple formats using Key class
    key_obj = Key.from_musical(musical_key)

    if key_obj:
        formats = {
            'musical': key_obj.musical,
            'openkey': key_obj.openkey,
            'camelot': key_obj.camelot,
            'engine_id': key_obj.engine_id
        }
    else:
        # Fallback if Key class fails to parse
        formats = {
            'musical': musical_key,
            'openkey': None,
            'camelot': None,
            'engine_id': None
        }

    return {
        'key': musical_key,
        'formats': formats,
        'confidence': float(strength),
        'metadata': {
            'scale': scale,
            'analyzed_at': datetime.utcnow().isoformat() + 'Z'
        }
    }


def _detect_key_keyfinder(audio_path: str) -> dict:
    """
    Detect musical key using libkeyfinder (DJ-optimized).

    Args:
        audio_path: Path to audio file

    Returns:
        dict with:
            - key: str (musical notation)
            - formats: dict (musical, openkey, camelot, engine_id)
            - confidence: float (always 1.0, keyfinder doesn't provide confidence)
            - metadata: {scale, analyzed_at}

    Raises:
        RuntimeError: If keyfinder-cli is not found or fails
    """
    # Find keyfinder-cli in common locations
    keyfinder_cli = None
    for path in [shutil.which('keyfinder-cli'),
                 os.path.expanduser('~/.local/bin/keyfinder-cli'),
                 '/usr/local/bin/keyfinder-cli']:
        if path and os.path.exists(path):
            keyfinder_cli = path
            break

    if not keyfinder_cli:
        raise RuntimeError(
            "keyfinder-cli not found. Install from: "
            "https://github.com/mixxxdj/libkeyfinder/"
        )

    try:
        # Get standard notation (default)
        result = subprocess.run(
            [keyfinder_cli, audio_path],
            capture_output=True,
            text=True,
            check=True
        )
        musical_key = result.stdout.strip()

        # Get Open Key notation
        result = subprocess.run(
            [keyfinder_cli, '-n', 'openkey', audio_path],
            capture_output=True,
            text=True,
            check=True
        )
        openkey = result.stdout.strip()

        # Convert to Key class for Camelot and engine_id
        key_obj = Key.from_musical(musical_key)
        if key_obj:
            formats = {
                'musical': key_obj.musical,
                'openkey': openkey,
                'camelot': key_obj.camelot,
                'engine_id': key_obj.engine_id
            }
            scale = 'minor' if 'm' in musical_key else 'major'
        else:
            # Fallback if Key class fails
            formats = {
                'musical': musical_key,
                'openkey': openkey,
                'camelot': None,
                'engine_id': None
            }
            scale = 'minor' if 'm' in musical_key else 'major'

        return {
            'key': musical_key,
            'formats': formats,
            'confidence': 1.0,  # keyfinder doesn't provide confidence
            'metadata': {
                'scale': scale,
                'analyzed_at': datetime.utcnow().isoformat() + 'Z'
            }
        }

    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"keyfinder-cli failed: {e.stderr}") from e


def analyze_key(audio_path: str) -> dict:
    """
    Detect musical key using configured backend.

    Backend is selected via config.toml [analysis] section:
    - "essentia": HPCP-based key detection (default)
    - "keyfinder": DJ-optimized key detection

    Args:
        audio_path: Path to audio file

    Returns:
        dict with:
            - key: str (musical notation)
            - formats: dict (musical, openkey, camelot, engine_id)
            - confidence: float
            - metadata: {scale, analyzed_at}

    Raises:
        ValueError: If invalid backend configured
        RuntimeError: If backend fails
    """
    config = get_config()
    backend = config.analysis.key_detection_backend

    if backend == "essentia":
        return _detect_key_essentia(audio_path)
    elif backend == "keyfinder":
        return _detect_key_keyfinder(audio_path)
    else:
        raise ValueError(
            f"Invalid key detection backend: '{backend}'. "
            f"Must be 'essentia' or 'keyfinder'"
        )

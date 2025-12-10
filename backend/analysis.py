"""Audio analysis module for BPM and key detection using Essentia.

This module provides functions for analyzing audio files to detect BPM (beats per minute)
and musical key using multiple strategies.
"""

from datetime import datetime
from collections import Counter
from typing import Optional
import numpy as np
import essentia.standard as es
import subprocess
import shutil
import os

from .key import Key
from .config import get_config


# BPM estimate ordering by profiling accuracy (most accurate first)
# Update this list based on profiling results to change the order of estimates
BPM_ESTIMATE_ORDER = [
    'chunks_mode_mean_snap',        # Most accurate (from latest profiling)
    'trimmed_mean_snap',             # Second most accurate
    'chunks_median_detected_snap',
    'chunks_median_mean_snap',
    'chunks_mode_detected_snap',
    'trimmed_detected_snap',
    'full_detected_snap',
    'full_mean_snap',                # Least accurate
]


def _load_audio(audio_path: str, trim_seconds: float = 0) -> tuple[np.ndarray, int]:
    """
    Load audio file using Essentia's MonoLoader.

    Args:
        audio_path: Path to audio file
        trim_seconds: Seconds to trim from start and end (0 = no trim)

    Returns:
        Tuple of (audio, sample_rate)
    """
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


def _detect_bpm_full(audio_path: str) -> dict:
    """
    Detect BPM using full track.

    Returns:
        dict: BPM and analysis results
    """
    audio, sample_rate = _load_audio(audio_path, trim_seconds=0)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    # Calculate statistics from beat intervals
    if len(bpm_intervals) > 0:
        interval_bpms = 60.0 / bpm_intervals
        mean_bpm = float(np.mean(interval_bpms))
    else:
        mean_bpm = float(bpm)

    return {
        'bpm': float(bpm),
        'bpm_snapped': round(float(bpm)),
        'mean_bpm': mean_bpm,
        'confidence': float(beats_confidence),
        'total_beats': len(beats),
        'duration': len(audio) / sample_rate,
    }


def _detect_bpm_trimmed(audio_path: str, trim_seconds: float = 15.0) -> dict:
    """
    Detect BPM with intro/outro trimmed.

    Args:
        audio_path: Path to audio file
        trim_seconds: Seconds to trim from start and end

    Returns:
        dict: BPM and analysis results
    """
    audio, sample_rate = _load_audio(audio_path, trim_seconds=trim_seconds)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    # Calculate statistics from beat intervals
    if len(bpm_intervals) > 0:
        interval_bpms = 60.0 / bpm_intervals
        mean_bpm = float(np.mean(interval_bpms))
    else:
        mean_bpm = float(bpm)

    return {
        'bpm': float(bpm),
        'bpm_snapped': round(float(bpm)),
        'mean_bpm': mean_bpm,
        'confidence': float(beats_confidence),
        'total_beats': len(beats),
        'duration': len(audio) / sample_rate,
    }


def _detect_bpm_chunks(audio_path: str, chunk_duration: float = 30.0) -> list[dict]:
    """
    Detect BPM for every chunk of the track.

    Args:
        audio_path: Path to audio file
        chunk_duration: Duration of each chunk in seconds

    Returns:
        list: List of dicts with BPM for each chunk
    """
    audio, sample_rate = _load_audio(audio_path, trim_seconds=0)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")

    chunks = []
    chunk_samples = int(chunk_duration * sample_rate)

    for start_sample in range(0, len(audio), chunk_samples):
        end_sample = min(start_sample + chunk_samples, len(audio))
        chunk_audio = audio[start_sample:end_sample]

        # Skip very short chunks
        if len(chunk_audio) < sample_rate * 5:  # At least 5 seconds
            continue

        try:
            bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(chunk_audio)

            # Calculate mean from intervals
            if len(bpm_intervals) > 0:
                interval_bpms = 60.0 / bpm_intervals
                mean_bpm = float(np.mean(interval_bpms))
            else:
                mean_bpm = float(bpm)

            chunks.append({
                'bpm': float(bpm),
                'bpm_snapped': round(float(bpm)),
                'mean_bpm': mean_bpm,
                'mean_bpm_snapped': round(mean_bpm),
                'confidence': float(beats_confidence),
            })
        except Exception:
            # If analysis fails for a chunk, skip it
            continue

    return chunks


def analyze_bpm(audio_path: str) -> dict:
    """
    Analyze BPM using multiple strategies including chunk-based analysis.

    Args:
        audio_path: Path to audio file

    Returns:
        dict with:
            - estimates: list of {method, bpm, confidence}
            - recommended_bpms: list of unique BPMs in order of accuracy
            - recommended_bpm: int (most reliable estimate)
            - metadata: {duration, analyzed_at}
    """
    # Run detection strategies
    full = _detect_bpm_full(audio_path)
    trimmed = _detect_bpm_trimmed(audio_path, trim_seconds=15.0)

    # Calculate chunk-based estimates (always included for best accuracy)
    chunks = _detect_bpm_chunks(audio_path, chunk_duration=30.0)

    chunk_estimates = {}
    if len(chunks) > 0:
        chunk_detected_snapped = [c['bpm_snapped'] for c in chunks]
        chunk_mean_snapped = [c['mean_bpm_snapped'] for c in chunks]

        # Calculate average confidence from chunks
        avg_confidence = float(np.mean([c['confidence'] for c in chunks]))

        chunk_estimates = {
            'chunks_mode_mean_snap': {
                'bpm': Counter(chunk_mean_snapped).most_common(1)[0][0],
                'confidence': avg_confidence
            },
            'chunks_median_detected_snap': {
                'bpm': int(round(np.median(chunk_detected_snapped))),
                'confidence': avg_confidence
            },
            'chunks_median_mean_snap': {
                'bpm': int(round(np.median(chunk_mean_snapped))),
                'confidence': avg_confidence
            },
            'chunks_mode_detected_snap': {
                'bpm': Counter(chunk_detected_snapped).most_common(1)[0][0],
                'confidence': avg_confidence
            },
        }

    # Build all available estimates in a dictionary for easy lookup
    all_estimates = {
        'trimmed_mean_snap': {
            'bpm': round(trimmed['mean_bpm']),
            'confidence': trimmed['confidence']
        },
        'trimmed_detected_snap': {
            'bpm': trimmed['bpm_snapped'],
            'confidence': trimmed['confidence']
        },
        'full_detected_snap': {
            'bpm': full['bpm_snapped'],
            'confidence': full['confidence']
        },
        'full_mean_snap': {
            'bpm': round(full['mean_bpm']),
            'confidence': full['confidence']
        },
    }

    # Add chunk estimates if available
    if chunk_estimates:
        all_estimates.update(chunk_estimates)

    # Build ordered estimates list using BPM_ESTIMATE_ORDER constant
    estimates = []
    for method in BPM_ESTIMATE_ORDER:
        if method in all_estimates:
            estimates.append({
                'method': method,
                'bpm': all_estimates[method]['bpm'],
                'confidence': all_estimates[method]['confidence']
            })

    # Build deduplicated list of BPMs (keep first occurrence only)
    seen_bpms = set()
    recommended_bpms = []
    for estimate in estimates:
        if estimate['bpm'] not in seen_bpms:
            seen_bpms.add(estimate['bpm'])
            recommended_bpms.append(estimate['bpm'])

    return {
        'estimates': estimates,  # All estimates with duplicates
        'recommended_bpms': recommended_bpms,  # Deduplicated list in order of accuracy
        'recommended_bpm': recommended_bpms[0],  # Most accurate BPM
        'metadata': {
            'duration': full['duration'],
            'analyzed_at': datetime.utcnow().isoformat() + 'Z'
        }
    }


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

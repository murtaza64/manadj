"""Utilities for converting between musical keys and OpenKey notation."""

from typing import Optional

# Mapping from musical key notation to OpenKey notation
# OpenKey uses: 1m-12m for minor keys, 1d-12d for major keys
KEY_TO_OPENKEY = {
    # Major keys (d notation)
    "C": "1d", "G": "2d", "D": "3d", "A": "4d", "E": "5d", "B": "6d",
    "F#": "7d", "Gb": "7d", "Db": "8d", "C#": "8d", "Ab": "9d", "Eb": "10d",
    "Bb": "11d", "F": "12d",
    # Minor keys (m notation)
    "Am": "1m", "Em": "2m", "Bm": "3m", "F#m": "4m", "Gbm": "4m",
    "C#m": "5m", "Dbm": "5m", "G#m": "6m", "Abm": "6m", "D#m": "7m",
    "Ebm": "7m", "Bbm": "8m", "Fm": "9m", "Cm": "10m", "Gm": "11m", "Dm": "12m",
}

# Reverse mapping from OpenKey notation to musical key notation
# For enharmonic equivalents, we pick the more common sharp/flat variant
OPENKEY_TO_KEY = {
    # Major keys (d notation)
    "1d": "C", "2d": "G", "3d": "D", "4d": "A", "5d": "E", "6d": "B",
    "7d": "F#", "8d": "Db", "9d": "Ab", "10d": "Eb", "11d": "Bb", "12d": "F",
    # Minor keys (m notation)
    "1m": "Am", "2m": "Em", "3m": "Bm", "4m": "F#m", "5m": "C#m",
    "6m": "G#m", "7m": "D#m", "8m": "Bbm", "9m": "Fm", "10m": "Cm",
    "11m": "Gm", "12m": "Dm",
}


def key_to_openkey(key: Optional[str]) -> Optional[str]:
    """Convert musical key notation to OpenKey notation.

    Args:
        key: Musical key like 'Am', 'C', 'F#m', etc.

    Returns:
        OpenKey notation like '1m', '1d', etc., or None if key is invalid/None

    Examples:
        >>> key_to_openkey('Am')
        '1m'
        >>> key_to_openkey('C')
        '1d'
        >>> key_to_openkey('F#m')
        '4m'
        >>> key_to_openkey(None)
        None
    """
    if not key:
        return None
    return KEY_TO_OPENKEY.get(key)


def openkey_to_key(openkey: Optional[str]) -> Optional[str]:
    """Convert OpenKey notation to musical key notation.

    Args:
        openkey: OpenKey notation like '1m', '1d', etc.

    Returns:
        Musical key like 'Am', 'C', etc., or None if openkey is invalid/None

    Examples:
        >>> openkey_to_key('1m')
        'Am'
        >>> openkey_to_key('1d')
        'C'
        >>> openkey_to_key('4m')
        'F#m'
        >>> openkey_to_key(None)
        None
    """
    if not openkey:
        return None
    return OPENKEY_TO_KEY.get(openkey)


def get_all_openkey_keys() -> list[str]:
    """Get all valid OpenKey key notations in order.

    Returns:
        List of all OpenKey keys: ['1m', '2m', ..., '12m', '1d', '2d', ..., '12d']
    """
    # Generate in order: all m keys (minor) then all d keys (major)
    keys = []
    for num in range(1, 13):
        keys.append(f"{num}m")
    for num in range(1, 13):
        keys.append(f"{num}d")
    return keys

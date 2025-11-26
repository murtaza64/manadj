"""Unified musical key representation supporting multiple formats."""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Key:
    """Immutable musical key representation supporting multiple formats.

    Uses Engine DJ key IDs (0-23) as the canonical internal representation.
    Supports conversion between:
    - Engine DJ ID (0-23)
    - Musical notation (e.g., "C", "Am", "F#m", "Db")
    - OpenKey notation (e.g., "1d", "1m", "12d", "12m")
    - Camelot notation (e.g., "8B", "8A", "1B", "1A")
    - Mixxx ID (1-24)
    - Rekordbox format (same as musical notation)

    Handles enharmonic equivalents (F#/Gb, C#/Db, etc.) in equality checks.
    """

    _engine_id: int | None  # 0-23 (canonical representation)

    # Engine DJ ID → (Musical, Camelot, OpenKey, Mixxx ID)
    _ENGINE_TO_ALL = {
        0: ("C", "8B", "1d", 1),
        1: ("Am", "8A", "1m", 22),
        2: ("G", "9B", "2d", 8),
        3: ("Em", "9A", "2m", 17),
        4: ("D", "10B", "3d", 3),
        5: ("Bm", "10A", "3m", 24),
        6: ("A", "11B", "4d", 10),
        7: ("F#m", "11A", "4m", 19),
        8: ("E", "12B", "5d", 5),
        9: ("C#m", "12A", "5m", 14),
        10: ("B", "1B", "6d", 12),
        11: ("G#m", "1A", "6m", 21),
        12: ("F#", "2B", "7d", 7),
        13: ("D#m", "2A", "7m", 16),
        14: ("Db", "3B", "8d", 2),
        15: ("Bbm", "3A", "8m", 23),
        16: ("Ab", "4B", "9d", 9),
        17: ("Fm", "4A", "9m", 18),
        18: ("Eb", "5B", "10d", 4),
        19: ("Cm", "5A", "10m", 13),
        20: ("Bb", "6B", "11d", 11),
        21: ("Gm", "6A", "11m", 20),
        22: ("F", "7B", "12d", 6),
        23: ("Dm", "7A", "12m", 15),
    }

    # Reverse mappings
    _MUSICAL_TO_ENGINE = {v[0]: k for k, v in _ENGINE_TO_ALL.items()}
    _CAMELOT_TO_ENGINE = {v[1]: k for k, v in _ENGINE_TO_ALL.items()}
    _OPENKEY_TO_ENGINE = {v[2]: k for k, v in _ENGINE_TO_ALL.items()}
    _MIXXX_TO_ENGINE = {v[3]: k for k, v in _ENGINE_TO_ALL.items()}

    # Enharmonic equivalents and alternative formats (map to canonical form in _ENGINE_TO_ALL)
    _ENHARMONIC = {
        "Gb": "F#", "Gbm": "F#m",
        "C#": "Db", "Dbm": "C#m",
        "Ab": "Ab", "Abm": "G#m",
        "Eb": "Eb", "Ebm": "D#m",
        "Bb": "Bb", "Bbm": "Bbm",
        # Alternative formats (e.g., "F Minor", "Ab Minor")
        "C Major": "C", "C Minor": "Cm",
        "G Major": "G", "G Minor": "Gm",
        "D Major": "D", "D Minor": "Dm",
        "A Major": "A", "A Minor": "Am",
        "E Major": "E", "E Minor": "Em",
        "B Major": "B", "B Minor": "Bm",
        "F Major": "F", "F Minor": "Fm",
        "Db Major": "Db", "Db Minor": "C#m",
        "Ab Major": "Ab", "Ab Minor": "G#m",
        "Eb Major": "Eb", "Eb Minor": "D#m",
        "Bb Major": "Bb", "Bb Minor": "Bbm",
        "F# Major": "F#", "F# Minor": "F#m",
        "C# Major": "Db", "C# Minor": "C#m",
        "G# Major": "Ab", "G# Minor": "G#m",
    }

    @classmethod
    def from_engine_id(cls, engine_id: int | None) -> "Key | None":
        """Create Key from Engine DJ ID (0-23)."""
        if engine_id is None or engine_id not in cls._ENGINE_TO_ALL:
            return None
        return cls(_engine_id=engine_id)

    @classmethod
    def from_musical(cls, key: str | None) -> "Key | None":
        """Create Key from musical notation (e.g., "C", "Am", "F#m").

        Also handles OpenKey (e.g., "2m") and Camelot (e.g., "4A") formats.
        """
        if key is None:
            return None

        # Try direct lookup
        engine_id = cls._MUSICAL_TO_ENGINE.get(key)
        if engine_id is not None:
            return cls(_engine_id=engine_id)

        # Try OpenKey format (e.g., "2m", "1d")
        if key and (key.endswith('m') or key.endswith('d')) and len(key) >= 2:
            maybe_openkey = cls.from_openkey(key)
            if maybe_openkey is not None:
                return maybe_openkey

        # Try Camelot format (e.g., "4A", "8B")
        if key and (key.endswith('A') or key.endswith('B')) and len(key) >= 2:
            maybe_camelot = cls.from_camelot(key)
            if maybe_camelot is not None:
                return maybe_camelot

        # Try enharmonic/alternative format equivalent
        canonical = cls._ENHARMONIC.get(key)
        if canonical:
            engine_id = cls._MUSICAL_TO_ENGINE.get(canonical)
            if engine_id is not None:
                return cls(_engine_id=engine_id)

        return None

    @classmethod
    def from_openkey(cls, openkey: str | None) -> "Key | None":
        """Create Key from OpenKey notation (e.g., "1d", "1m", "12d")."""
        if openkey is None:
            return None
        engine_id = cls._OPENKEY_TO_ENGINE.get(openkey)
        if engine_id is None:
            return None
        return cls(_engine_id=engine_id)

    @classmethod
    def from_camelot(cls, camelot: str | None) -> "Key | None":
        """Create Key from Camelot notation (e.g., "8B", "8A", "1B")."""
        if camelot is None:
            return None
        engine_id = cls._CAMELOT_TO_ENGINE.get(camelot)
        if engine_id is None:
            return None
        return cls(_engine_id=engine_id)

    @classmethod
    def from_mixxx_id(cls, mixxx_id: int | None) -> "Key | None":
        """Create Key from Mixxx ID (1-24)."""
        if mixxx_id is None:
            return None
        engine_id = cls._MIXXX_TO_ENGINE.get(mixxx_id)
        if engine_id is None:
            return None
        return cls(_engine_id=engine_id)

    @classmethod
    def from_rekordbox(cls, rb_key: str | None) -> "Key | None":
        """Create Key from Rekordbox format (same as musical notation)."""
        return cls.from_musical(rb_key)

    @property
    def engine_id(self) -> int | None:
        """Get Engine DJ ID (0-23)."""
        return self._engine_id

    @property
    def musical(self) -> str | None:
        """Get musical notation (e.g., "C", "Am", "F#m")."""
        if self._engine_id is None:
            return None
        return self._ENGINE_TO_ALL[self._engine_id][0]

    @property
    def camelot(self) -> str | None:
        """Get Camelot notation (e.g., "8B", "8A", "1B")."""
        if self._engine_id is None:
            return None
        return self._ENGINE_TO_ALL[self._engine_id][1]

    @property
    def openkey(self) -> str | None:
        """Get OpenKey notation (e.g., "1d", "1m", "12d")."""
        if self._engine_id is None:
            return None
        return self._ENGINE_TO_ALL[self._engine_id][2]

    @property
    def mixxx_id(self) -> int | None:
        """Get Mixxx ID (1-24)."""
        if self._engine_id is None:
            return None
        return self._ENGINE_TO_ALL[self._engine_id][3]

    @property
    def rekordbox(self) -> str | None:
        """Get Rekordbox format (same as musical notation)."""
        return self.musical

    def __str__(self) -> str:
        """String representation (returns musical notation)."""
        return self.musical if self.musical else "None"

    def __repr__(self) -> str:
        """Detailed representation."""
        if self._engine_id is None:
            return "Key(None)"
        return f"Key({self.musical} / {self.camelot} / {self.openkey})"

    def __eq__(self, other) -> bool:
        """Equality check (based on Engine DJ ID, handles enharmonics naturally)."""
        if not isinstance(other, Key):
            return False
        return self._engine_id == other._engine_id

    def __hash__(self) -> int:
        """Hash based on Engine DJ ID."""
        return hash(self._engine_id)

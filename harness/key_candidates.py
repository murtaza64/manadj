"""Key candidates: detectors producing a Key estimate.

Same contract for every contender — audio path in, (Key, confidence) out —
with heavy deps imported inside methods only (import-hygiene guard).
Candidates in this slice: Essentia KeyExtractor swept across profiles
(current default plus the EDM-tuned Faraldo profiles) and libkeyfinder.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from typing import Protocol

from backend.key import Key


class KeyCandidate(Protocol):
    name: str

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        """Returns (estimate, confidence). (None, None) when undetectable."""
        ...


class EssentiaKey(KeyCandidate):
    """Essentia KeyExtractor with a given profile. `edma`/`edmm` and
    `bgate`/`braw` are the EDM-tuned profiles (Faraldo); `default` is
    whatever the installed Essentia ships, matching the current app path."""

    def __init__(self, profile: str | None) -> None:
        self.profile = profile
        self.name = f"essentia_{profile or 'default'}"

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        import essentia.standard as es  # heavy: candidates only

        audio = es.MonoLoader(filename=audio_path, sampleRate=44100)()
        extractor = es.KeyExtractor(profileType=self.profile) if self.profile else es.KeyExtractor()
        key, scale, strength = extractor(audio)
        musical = f"{key}m" if scale.lower() == "minor" else key
        return Key.from_musical(musical), float(strength)


class KeyfinderCli(KeyCandidate):
    """libkeyfinder via keyfinder-cli (Mixxx's key library), matching the
    app's existing alternative backend."""

    name = "keyfinder"

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        cli = self._find_cli()
        result = subprocess.run(
            [cli, audio_path], capture_output=True, text=True, check=True
        )
        return Key.from_musical(result.stdout.strip()), None

    @staticmethod
    def _find_cli() -> str:
        for path in (
            shutil.which("keyfinder-cli"),
            os.path.expanduser("~/.local/bin/keyfinder-cli"),
            "/usr/local/bin/keyfinder-cli",
        ):
            if path and os.path.exists(path):
                return path
        raise RuntimeError("keyfinder-cli not found")


def _all_candidates() -> dict[str, KeyCandidate]:
    candidates: list[KeyCandidate] = [
        EssentiaKey(None),
        EssentiaKey("edma"),
        EssentiaKey("edmm"),
        EssentiaKey("bgate"),
        EssentiaKey("braw"),
        KeyfinderCli(),
    ]
    return {c.name: c for c in candidates}


KEY_CANDIDATES: dict[str, KeyCandidate] = _all_candidates()

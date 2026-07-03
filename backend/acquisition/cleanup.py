"""Cleanup: normalizing raw Source metadata into Track title/artist.

Rule-based (see CONTEXT.md: Cleanup): strip configurable junk tokens, split
`Artist - Title`, fall back to the uploader as artist. Applied at Track
creation during Acquisition; the same rules name the downloaded file.
"""

import re
from dataclasses import dataclass, field

DEFAULT_JUNK_PATTERNS = [
    r"free\s+(download|dl)",
    r"out\s+now",
    r"coming\s+soon",
    r"ncs\s+release",
    r"premiere",
]

# Emoji / symbol ranges commonly pasted into SoundCloud titles
_SYMBOLS = re.compile(
    "[\u2600-\u27bf\U0001f000-\U0001fbff\u2b00-\u2bff\ufe0f]",
)


@dataclass(frozen=True)
class CleanupConfig:
    junk_patterns: list[str] = field(default_factory=lambda: list(DEFAULT_JUNK_PATTERNS))


@dataclass(frozen=True)
class CleanedMetadata:
    artist: str | None
    title: str


def _strip_junk(text: str, config: CleanupConfig) -> str:
    for pattern in config.junk_patterns:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    text = _SYMBOLS.sub(" ", text)
    # brackets left empty (or with only punctuation) after junk removal
    text = re.sub(r"[\[(]\s*[\])]", " ", text)
    text = re.sub(r"\s+", " ", text)
    # separators orphaned at either end after junk removal (e.g. "Title //")
    return text.strip(" -–—_/|•·~")


def clean_metadata(raw_title: str, uploader: str, config: CleanupConfig) -> CleanedMetadata:
    """Derive artist/title from a Source Item's raw title and uploader."""
    cleaned = _strip_junk(raw_title, config)
    if " - " in cleaned:
        artist_part, title_part = cleaned.split(" - ", 1)
        artist = artist_part.strip() or None
        title = title_part.strip()
    else:
        artist = uploader.strip() or None
        title = cleaned
    return CleanedMetadata(artist=artist, title=title or raw_title)


def safe_basename(artist: str | None, title: str) -> str:
    """`Artist - Title` with path-hostile characters replaced."""
    name = f"{artist} - {title}" if artist else title
    name = re.sub(r"[/\\:]", "-", name)
    name = re.sub(r'[<>|"*?]', "", name)
    return re.sub(r"\s+", " ", name).strip()

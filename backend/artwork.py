"""Track artwork for the clip exporter (#384): embedded art, else scraped.

Order: the file's embedded picture (ID3 APIC / MP4 covr / FLAC picture),
then a Deezer search, then an iTunes search, on artist + title (bracketed
noise and "feat." stripped). Results are cached under
`<data root>/artwork/<track id>.jpg`; misses leave a `.none` marker that
expires after a week.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import httpx
from mutagen import File as MutagenFile

from .data_root import data_root

MISS_TTL_SEC = 7 * 24 * 3600
_TIMEOUT = 6.0


def _cache_dir() -> Path:
    d = data_root() / "artwork"
    d.mkdir(parents=True, exist_ok=True)
    return d


def embedded_artwork(path: str) -> bytes | None:
    try:
        f = MutagenFile(path)
    except Exception:
        return None
    if f is None:
        return None
    pictures = getattr(f, "pictures", None)
    if pictures:
        return pictures[0].data
    tags = f.tags
    if not tags:
        return None
    for key in tags.keys():
        if key.startswith("APIC"):
            return tags[key].data
    covr = tags.get("covr") if hasattr(tags, "get") else None
    if covr:
        return bytes(covr[0])
    return None


def _clean(s: str) -> str:
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|!+", " ", s)
    s = re.sub(r"\b(feat\.?|ft\.?)\s.*$", " ", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _deezer(artist: str, title: str, client: httpx.Client) -> str | None:
    r = client.get("https://api.deezer.com/search", params={"q": f"{artist} {title}", "limit": 5})
    for hit in r.json().get("data", []):
        if _norm(title)[:8] in _norm(hit.get("title", "")) and (not artist or _norm(artist)[:6] in _norm(hit.get("artist", {}).get("name", ""))) or (artist and _norm(hit.get("artist", {}).get("name", "")) == _norm(artist) and _norm(title)[:4] in _norm(hit.get("title", ""))):
            return hit.get("album", {}).get("cover_xl")
    return None


def _itunes(artist: str, title: str, client: httpx.Client) -> str | None:
    r = client.get("https://itunes.apple.com/search", params={"term": f"{artist} {title}", "entity": "song", "limit": 5})
    for hit in r.json().get("results", []):
        if _norm(title)[:8] in _norm(hit.get("trackName", "")):
            url = hit.get("artworkUrl100")
            return url.replace("100x100bb", "1000x1000bb") if url else None
    return None


def scrape_artwork(artist: str, title: str) -> bytes | None:
    a = _clean(re.split(r",| x | & | vs\.? ", artist or "", flags=re.I)[0])
    t = _clean((title or "").split(" - ")[0])
    if not t:
        return None
    # Edits/flips/VIPs often aren't listed: the original's cover will do.
    queries = [(a, t), ("", t)]
    with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
        for (qa, qt), source in ((q, s) for q in queries for s in (_deezer, _itunes)):
            try:
                url = source(qa, qt, client)
                if url:
                    img = client.get(url)
                    if img.status_code == 200 and img.content:
                        return img.content
            except (httpx.HTTPError, ValueError):
                continue
    return None


def track_artwork(track_id: int, filename: str, artist: str | None, title: str | None, refresh: bool = False) -> Path | None:
    """Cached artwork file for a track, fetching it on first use."""
    d = _cache_dir()
    hit = d / f"{track_id}.jpg"
    if hit.exists():
        return hit
    miss = d / f"{track_id}.none"
    if not refresh and miss.exists() and time.time() - miss.stat().st_mtime < MISS_TTL_SEC:
        return None
    data = embedded_artwork(filename) or scrape_artwork(artist or "", title or "")
    if not data:
        miss.touch()
        return None
    hit.write_bytes(data)
    return hit

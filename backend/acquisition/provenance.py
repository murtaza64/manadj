"""Origin labels for Audio Provenance (ADR-0006).

External Sources are identified by URL only; the label is derived from the
URL host — known-host map first, else the bare host with `www.` stripped.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from mutagen import File as MutagenFile  # type: ignore[attr-defined]

KNOWN_HOSTS = {
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "beatport.com": "beatport",
    "bandcamp.com": "bandcamp",
    "soundcloud.com": "soundcloud",
    "mixcloud.com": "mixcloud",
}


def is_url(text: str) -> bool:
    return text.startswith(("http://", "https://"))


def derive_label(url: str) -> str:
    """Origin label from a URL's host."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if host in KNOWN_HOSTS:
        return KNOWN_HOSTS[host]
    # artist subdomains (e.g. sansibar.bandcamp.com)
    for known, label in KNOWN_HOSTS.items():
        if host.endswith("." + known):
            return label
    return host


# --------------------------------------------------------------------------
# Hint derivation: origin evidence left in files by yt-dlp / store purchases.
# Shared by the Disk Import path and scripts/backfill_provenance.py.

PAT_SC_ID = re.compile(r"\[(\d{6,12})\]")
PAT_YT_ID = re.compile(r"\[([A-Za-z0-9_-]{11})\]")
URL_RE = re.compile(r"https?://[^\s\"']+")


@dataclass
class ProvenanceHint:
    """Derived origin evidence for one audio file. Always written asserted:
    manadj did not witness the acquisition."""

    rule: str
    label: str
    url: str | None
    external_id: str | None
    confirms_item_id: int | None  # unfulfilled Source Item confirmed by exact ID


def dedicated_tag_urls(path: Path) -> list[str]:
    """URLs from dedicated URL tags only (comment, purl, WOAF) — never
    descriptions, which are full of promo-link noise."""
    try:
        audio = MutagenFile(str(path))
        if audio is None or not audio.tags:
            return []
    except Exception:
        return []
    urls: list[str] = []
    for key in audio.tags.keys():
        k = str(key)
        if not (k.startswith(("\xa9cmt", "COMM", "WOAF", "purl")) or k == "TXXX:purl"):
            continue
        try:
            vals = audio.tags[key]
            text = " ".join(str(v) for v in (vals if isinstance(vals, list) else [vals]))
        except Exception:
            continue
        urls += URL_RE.findall(text)
    return urls


def derive_hint(
    path: Path,
    items_by_ext: "dict[str, object]",
    fulfilled_ext: set[str],
) -> ProvenanceHint | None:
    """Judge one file against the hint rules (tag URLs, then filename IDs)."""
    urls = dedicated_tag_urls(path) if path.exists() else []
    bp = [u for u in urls if "beatport.com" in u and "/track/" in u]
    sc = [u for u in urls if "soundcloud.com" in u]
    yt = [u for u in urls if "youtube.com" in u or "youtu.be" in u]
    m_sc = PAT_SC_ID.search(path.stem)
    m_yt = PAT_YT_ID.search(path.stem)

    if bp:
        return ProvenanceHint("beatport tag url", "beatport", bp[0], None, None)
    if sc:
        m_url_id = m_sc.group(1) if m_sc else None
        return ProvenanceHint("soundcloud tag url", "soundcloud", sc[0].rstrip("/"), m_url_id, None)
    if yt:
        return ProvenanceHint("youtube tag url", "youtube", yt[0], None, None)
    if m_sc:
        ext_id = m_sc.group(1)
        item = items_by_ext.get(ext_id)
        url = item.permalink_url if item else None  # type: ignore[attr-defined]
        confirms = item.id if item and ext_id not in fulfilled_ext else None  # type: ignore[attr-defined]
        rule = "soundcloud filename id" + (" (liked)" if item else "")
        return ProvenanceHint(rule, "soundcloud", url, ext_id, confirms)
    if m_yt:
        vid = m_yt.group(1)
        return ProvenanceHint(
            "youtube filename id", "youtube",
            f"https://www.youtube.com/watch?v={vid}", None, None,
        )
    return None


def acquired_at_from_file(path: Path) -> "datetime | None":
    """File birthtime = when the audio landed on this disk (the acquisition).

    mtime is deliberately NOT preferred: yt-dlp sets mtime to the media's
    upload date, which is when the artist posted it, not when it was acquired.
    Returned naive-UTC, consistent with the column's func.now() default.
    """
    if not path.exists():
        return None
    stat = path.stat()
    ts = getattr(stat, "st_birthtime", None) or stat.st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)


def derive_and_write_provenance(db, tracks) -> int:  # type: ignore[no-untyped-def]
    """For Tracks with no provenance row, judge their files and write asserted
    provenance; a filename SC ID matching an unfulfilled liked Source Item
    also confirms the correspondence. Returns rows written. Does not commit."""
    from .manager import upsert_confirmed_correspondence  # local: avoid cycle
    from .models import AudioProvenance, SourceCorrespondence, SourceItem

    items_by_ext = {i.external_id: i for i in db.query(SourceItem).all()}
    fulfilled_ext = {
        i.external_id
        for i in db.query(SourceItem)
        .join(SourceCorrespondence, SourceCorrespondence.source_item_id == SourceItem.id)
        .filter(SourceCorrespondence.status.in_(("proposed", "confirmed")))
        .all()
    }

    written = 0
    for track in tracks:
        existing = (
            db.query(AudioProvenance).filter(AudioProvenance.track_id == track.id).first()
        )
        if existing is not None:
            continue
        path = Path(str(track.filename))
        hint = derive_hint(path, items_by_ext, fulfilled_ext)
        if hint is None:
            continue
        db.add(
            AudioProvenance(
                track_id=track.id,
                source=hint.label,
                external_id=hint.external_id,
                url=hint.url,
                asserted=True,
                acquired_at=acquired_at_from_file(path),
            )
        )
        if hint.confirms_item_id is not None:
            upsert_confirmed_correspondence(db, hint.confirms_item_id, track.id)
            item = db.query(SourceItem).filter(SourceItem.id == hint.confirms_item_id).one()
            item.state = "fulfilled"
        written += 1
    return written

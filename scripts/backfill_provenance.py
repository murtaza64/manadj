"""One-time backfill of Audio Provenance for pre-manadj library tracks.

Detects origin hints left by yt-dlp and store purchases:
  1. Beatport track URL in the WOAF frame        -> beatport + url
  2. SoundCloud permalink in comment tags        -> soundcloud + url
  3. SoundCloud numeric ID in the filename       -> soundcloud + external id
     (permalink from the matching liked Source Item; optionally confirms the
     item's Source Correspondence by exact ID)
  4. YouTube video ID in the filename            -> youtube + reconstructed url

All rows are written asserted=True: manadj did not witness these downloads.
Tracks that already have provenance are never touched.

Usage:
    uv run scripts/backfill_provenance.py            # preview only (writes markdown)
    uv run scripts/backfill_provenance.py --apply    # write provenance + correspondences

Preview default: .scratch/soundcloud-acquisition/provenance-backfill-preview.md
"""

import argparse
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from mutagen import File as MutagenFile  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from backend.acquisition.models import AudioProvenance, SourceCorrespondence, SourceItem  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.models import Track  # noqa: E402

PAT_SC_ID = re.compile(r"\[(\d{6,12})\]")
PAT_YT_ID = re.compile(r"\[([A-Za-z0-9_-]{11})\]")
URL_RE = re.compile(r"https?://[^\s\"']+")

DEFAULT_OUT = Path(".scratch/soundcloud-acquisition/provenance-backfill-preview.md")


@dataclass
class Verdict:
    track_id: int
    filename: str
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


def judge(
    track_id: int,
    path: Path,
    items_by_ext: dict[str, SourceItem],
    fulfilled_ext: set[str],
) -> Verdict | None:
    urls = dedicated_tag_urls(path) if path.exists() else []
    bp = [u for u in urls if "beatport.com" in u and "/track/" in u]
    sc = [u for u in urls if "soundcloud.com" in u]
    yt = [u for u in urls if "youtube.com" in u or "youtu.be" in u]
    m_sc = PAT_SC_ID.search(path.stem)
    m_yt = PAT_YT_ID.search(path.stem)

    if bp:
        return Verdict(track_id, path.name, "beatport tag url", "beatport", bp[0], None, None)
    if sc:
        ext = None
        m_url_id = m_sc.group(1) if m_sc else None
        return Verdict(track_id, path.name, "soundcloud tag url", "soundcloud", sc[0].rstrip("/"), m_url_id or ext, None)
    if yt:
        return Verdict(track_id, path.name, "youtube tag url", "youtube", yt[0], None, None)
    if m_sc:
        ext_id = m_sc.group(1)
        item = items_by_ext.get(ext_id)
        url = item.permalink_url if item else None
        confirms = item.id if item and ext_id not in fulfilled_ext else None
        rule = "soundcloud filename id" + (" (liked)" if item else "")
        return Verdict(track_id, path.name, rule, "soundcloud", url, ext_id, confirms)
    if m_yt:
        vid = m_yt.group(1)
        return Verdict(
            track_id, path.name, "youtube filename id", "youtube",
            f"https://www.youtube.com/watch?v={vid}", None, None,
        )
    return None


def collect(db: Session) -> "tuple[list[Verdict], int]":
    rows = (
        db.query(Track)
        .outerjoin(AudioProvenance, AudioProvenance.track_id == Track.id)
        .filter(AudioProvenance.id.is_(None))
        .all()
    )
    items_by_ext = {i.external_id: i for i in db.query(SourceItem).all()}
    fulfilled_ext = {
        i.external_id
        for i in db.query(SourceItem)
        .join(SourceCorrespondence, SourceCorrespondence.source_item_id == SourceItem.id)
        .filter(SourceCorrespondence.status.in_(("proposed", "confirmed")))
        .all()
    }
    verdicts = []
    for track in rows:
        v = judge(track.id, Path(str(track.filename)), items_by_ext, fulfilled_ext)
        if v:
            verdicts.append(v)
    return verdicts, len(rows)


def write_preview(verdicts: list[Verdict], total_unprovenanced: int, out: Path) -> None:
    by_rule: dict[str, list[Verdict]] = {}
    for v in verdicts:
        by_rule.setdefault(v.rule, []).append(v)
    lines = [
        "# Provenance backfill preview",
        "",
        f"{len(verdicts)} of {total_unprovenanced} unprovenanced tracks matched a rule.",
        "Review, then run `uv run scripts/backfill_provenance.py --apply`.",
        "",
    ]
    for rule, vs in sorted(by_rule.items(), key=lambda kv: -len(kv[1])):
        lines += [f"## {rule} ({len(vs)})", ""]
        lines.append("| track | label | url / id | confirms item |")
        lines.append("|---|---|---|---|")
        for v in sorted(vs, key=lambda x: x.filename.lower()):
            ident = v.url or v.external_id or ""
            confirms = f"#{v.confirms_item_id}" if v.confirms_item_id else ""
            lines.append(f"| {v.filename} | {v.label} | {ident} | {confirms} |")
        lines.append("")
    confirm_count = sum(1 for v in verdicts if v.confirms_item_id)
    lines.append(f"_{confirm_count} unfulfilled Source Items would be confirmed by exact ID._")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"preview written to {out} ({len(verdicts)} rows)")


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


def apply(db: Session, verdicts: list[Verdict], tracks_by_id: "dict[int, str]") -> None:
    confirmed = 0
    for v in verdicts:
        db.add(
            AudioProvenance(
                track_id=v.track_id,
                source=v.label,
                external_id=v.external_id,
                url=v.url,
                asserted=True,
                acquired_at=acquired_at_from_file(Path(tracks_by_id[v.track_id])),
            )
        )
        if v.confirms_item_id is not None:
            existing = (
                db.query(SourceCorrespondence)
                .filter(SourceCorrespondence.source_item_id == v.confirms_item_id)
                .one_or_none()
            )
            if existing is None:
                db.add(
                    SourceCorrespondence(
                        source_item_id=v.confirms_item_id, track_id=v.track_id, status="confirmed"
                    )
                )
                item = db.query(SourceItem).filter(SourceItem.id == v.confirms_item_id).one()
                item.state = "fulfilled"
                confirmed += 1
    db.commit()
    print(f"applied: {len(verdicts)} provenance rows, {confirmed} correspondences confirmed by ID")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write to the database")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="preview output path")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        verdicts, total = collect(db)
        write_preview(verdicts, total, args.out)
        if args.apply:
            tracks_by_id = {t.id: str(t.filename) for t in db.query(Track).all()}
            apply(db, verdicts, tracks_by_id)
        else:
            print("dry run — nothing written to the database")
    finally:
        db.close()


if __name__ == "__main__":
    main()

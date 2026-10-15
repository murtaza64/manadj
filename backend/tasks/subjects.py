"""Task subjects and labels (gh#342): what a task is about, in words.

A task's `ref` ("track:779", "source_item:850", "session:<uuid>") is a
pointer; the UI needs the thing it points at. This resolves refs in batch
to a Subject (kind, id, label) and gives every task type a human label and
a short description of what success means — so the Tasks drawer reads
"Waveform · Hoax - Wake Up" instead of "waveform #4821 track:779".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timezone

from sqlalchemy.orm import Session

from .models import Task

TYPE_LABELS: dict[str, str] = {
    "waveform": "Waveform",
    "analysis": "Analysis",
    "stem-split": "Stem split",
    "download": "SoundCloud download",
    "soulseek-download": "Soulseek download",
    "soulseek-search": "Soulseek search",
    "routine-mine": "Routine mining",
    "rekordbox-onboarding-import": "Rekordbox import",
    "tracks-directory-import": "Tracks directory import",
}

# What a failure of this type means for the user, and where the fix lives.
# `fix`: "retry" (the task itself can be retried) | "acquisition" (the
# Source Item's row in Sync → Acquisition carries the next step) | "none".
TYPE_FIX: dict[str, str] = {
    "waveform": "retry",
    "analysis": "retry",
    "stem-split": "retry",
    "download": "acquisition",
    "soulseek-download": "acquisition",
    "soulseek-search": "acquisition",
    "routine-mine": "retry",
    "rekordbox-onboarding-import": "retry",
    "tracks-directory-import": "retry",
}


def type_label(type_: str) -> str:
    return TYPE_LABELS.get(type_, type_.replace("-", " ").capitalize())


def type_fix(type_: str) -> str:
    return TYPE_FIX.get(type_, "retry")


@dataclass(frozen=True)
class Subject:
    kind: str  # track | source_item | session | other
    id: str
    label: str
    # a second line: uploader / artist / date
    detail: str | None = None


def parse_ref(ref: str | None) -> tuple[str, str] | None:
    """("track", "779") from "track:779"; the soulseek-search ref carries a
    suffix ("source_item:725:soulseek-search") — the subject is the item."""
    if not ref:
        return None
    parts = ref.split(":", 2)
    if len(parts) < 2 or not parts[1]:
        return None
    return parts[0], parts[1]


def resolve_subjects(db: Session, tasks: list[Task]) -> dict[int, Subject]:
    """task.id -> Subject, resolved in one query per kind."""
    from ..acquisition.models import SourceItem
    from ..models import Session as PerfSession
    from ..models import Track

    wanted: dict[str, set[str]] = {}
    parsed: dict[int, tuple[str, str]] = {}
    for t in tasks:
        p = parse_ref(t.ref)
        if p is None:
            continue
        parsed[t.id] = p
        wanted.setdefault(p[0], set()).add(p[1])

    labels: dict[tuple[str, str], Subject] = {}
    track_ids = [int(i) for i in wanted.get("track", ()) if i.isdigit()]
    if track_ids:
        for tr in db.query(Track).filter(Track.id.in_(track_ids)).all():
            title = tr.title or tr.filename.rsplit("/", 1)[-1]
            labels[("track", str(tr.id))] = Subject("track", str(tr.id), title, tr.artist)
    item_ids = [int(i) for i in wanted.get("source_item", ()) if i.isdigit()]
    if item_ids:
        for it in db.query(SourceItem).filter(SourceItem.id.in_(item_ids)).all():
            labels[("source_item", str(it.id))] = Subject("source_item", str(it.id), it.title, it.uploader)
    uuids = list(wanted.get("session", ()))
    if uuids:
        for s in db.query(PerfSession).filter(PerfSession.uuid.in_(uuids)).all():
            started = s.started_at.replace(tzinfo=timezone.utc).isoformat() if s.started_at else None
            labels[("session", s.uuid)] = Subject("session", s.uuid, "Session", started)

    out: dict[int, Subject] = {}
    for tid, (kind, ident) in parsed.items():
        out[tid] = labels.get((kind, ident)) or Subject(kind, ident, f"{kind} {ident} (gone)")
    return out

"""Device sync, phone → desktop (ADR 0045, #375).

A Paired device pushes journaled field edits; each is applied newest-wins and
written to the Device change log (`DeviceSyncChange`). The phone also reports
what a pull changed on its side (`to_phone` rows). The desktop reverts an
entry or a batch by writing the old value back as a new logged change.

Field vocabulary and JSON values:
  hot_cue:<1-8>  {"time": float, "label": str|null, "color": str|null} | null
  main_cue       float | null
  tag:<id>       bool (assigned)
  title, artist  str | null
  energy         int 1-5 | null
  key            Engine DJ key id 0-23 | null
  grid           {"anchor_time": float|null, "tempo_changes": [{start_time, bpm,
                 time_signature_num, time_signature_den?, bar_position}]} | null
                 (null = no saved grid: generated placeholder / deleted)
  reset_marks    [float] Metric-ladder Reset marks, seconds (ADR 0029)
  link:<id>      bool (the Linked pair {track_id, id} exists; linked-pairs PRD,
                 #398) — pair-level: either Track may carry it, one fact per
                 unordered pair, written like PUT /api/track-links/pair/{a}/{b}
  setting:<key>  JSON object (a synced performance setting, device_sync
                 SYNCED_SETTINGS; track_id null) — the whole persisted value
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import AppSetting, Beatgrid, DeviceSyncChange, HotCue, MetricLadder, Tag, Track, TrackLink, TrackTag
from .track_metadata.manager import apply_update
from .track_metadata.models import TrackChanges

SCALAR_FIELDS = ("title", "artist", "energy", "key", "main_cue", "grid", "reset_marks")
DESKTOP = "desktop"


class FieldError(ValueError):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


SETTING_PREFIX = "setting:"


def setting_key(field: str) -> str | None:
    """The settings key of a `setting:<key>` field (validated), else None."""
    if not field.startswith(SETTING_PREFIX):
        return None
    from .routers.device_sync import SYNCED_SETTINGS

    key = field[len(SETTING_PREFIX):]
    if key not in SYNCED_SETTINGS:
        raise FieldError(f"setting not synced: {key}")
    return key


def _parse_field(field: str) -> tuple[str, int | None]:
    if field in SCALAR_FIELDS:
        return field, None
    kind, _, arg = field.partition(":")
    if kind in ("hot_cue", "tag", "link") and arg.isdigit():
        n = int(arg)
        if kind == "hot_cue" and not 1 <= n <= 8:
            raise FieldError(f"hot cue slot out of range: {field}")
        return kind, n
    raise FieldError(f"unsupported field: {field}")


# ── Read / write one field on the desktop ─────────────────────────────


def read_field(db: Session, track: Track, field: str) -> tuple[Any, datetime | None]:
    """(current value, when the desktop last changed it — best known)."""
    kind, n = _parse_field(field)
    if kind == "hot_cue":
        cue = db.query(HotCue).filter_by(track_id=track.id, slot_number=n).one_or_none()
        if cue is None:
            return None, track.updated_at
        return {"time": cue.time_seconds, "label": cue.label, "color": cue.color}, cue.updated_at
    if kind == "tag":
        tt = db.query(TrackTag).filter_by(track_id=track.id, tag_id=n).one_or_none()
        return (tt is not None), (tt.created_at if tt is not None else track.updated_at)
    if kind == "main_cue":
        return track.cue_point_time, track.updated_at
    if kind == "link":
        row = _link_row(db, track.id, n)
        return (row is not None), (row.created_at if row is not None else None)
    if kind == "grid":
        bg = db.query(Beatgrid).filter_by(track_id=track.id).one_or_none()
        if bg is None or bg.origin == "generated":
            return None, (bg.updated_at if bg is not None else None)
        return {"anchor_time": bg.anchor_time, "tempo_changes": json.loads(bg.tempo_changes_json)}, bg.updated_at
    if kind == "reset_marks":
        ladder = db.query(MetricLadder).filter_by(track_id=track.id).one_or_none()
        if ladder is None:
            return [], None
        return json.loads(ladder.reset_marks_json), ladder.updated_at
    return getattr(track, kind), track.updated_at


def _link_row(db: Session, a: int, b: int) -> TrackLink | None:
    low, high = sorted((a, b))
    return db.query(TrackLink).filter_by(low_track_id=low, high_track_id=high).one_or_none()


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _valid_grid(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    anchor = value.get("anchor_time")
    tcs = value.get("tempo_changes")
    if not (anchor is None or _num(anchor)) or not isinstance(tcs, list) or not tcs:
        return False
    return all(
        isinstance(tc, dict) and _num(tc.get("start_time")) and _num(tc.get("bpm")) and tc["bpm"] > 0
        and isinstance(tc.get("time_signature_num"), int) and isinstance(tc.get("bar_position"), int)
        for tc in tcs
    )


def _validate(kind: str, value: Any) -> None:
    ok = {
        "hot_cue": value is None or (isinstance(value, dict) and isinstance(value.get("time"), (int, float))),
        "tag": isinstance(value, bool),
        "link": isinstance(value, bool),
        "main_cue": value is None or isinstance(value, (int, float)),
        "title": value is None or isinstance(value, str),
        "artist": value is None or isinstance(value, str),
        "energy": value is None or (isinstance(value, int) and 1 <= value <= 5),
        "key": value is None or (isinstance(value, int) and 0 <= value <= 23),
        "grid": value is None or _valid_grid(value),
        "reset_marks": isinstance(value, list) and all(_num(m) and m >= 0 for m in value),
    }[kind]
    if not ok:
        raise FieldError(f"bad value for {kind}: {value!r}")


def write_field(db: Session, track: Track, field: str, value: Any) -> None:
    """Write through the same paths desktop edits use. Caller commits."""
    kind, n = _parse_field(field)
    _validate(kind, value)
    if kind == "hot_cue":
        cue = db.query(HotCue).filter_by(track_id=track.id, slot_number=n).one_or_none()
        if value is None:
            if cue is not None:
                db.delete(cue)
        else:
            if cue is None:
                cue = HotCue(track_id=track.id, slot_number=n, time_seconds=float(value["time"]))
                db.add(cue)
            cue.time_seconds = float(value["time"])
            cue.label = value.get("label")
            cue.color = value.get("color")
        return
    if kind == "tag":
        if db.get(Tag, n) is None:
            raise FieldError(f"unknown tag {n}")
        current = {tt.tag_id for tt in db.query(TrackTag).filter_by(track_id=track.id)}
        wanted = (current | {n}) if value else (current - {n})
        if wanted != current:
            apply_update(db, track, TrackChanges(tag_ids=sorted(wanted)))
        return
    if kind == "main_cue":
        track.cue_point_time = None if value is None else float(value)
        return
    if kind == "link":
        from .routers.track_links import write_pair_linked

        other = db.get(Track, n)
        if n == track.id or other is None or other.archived_at is not None:
            raise FieldError(f"bad link pair {track.id}/{n}")
        write_pair_linked(db, track.id, n, value)
        return
    if kind == "grid":
        from . import crud
        from .routers.beatgrids import delete_beatgrid

        if value is None:
            delete_beatgrid(track.id, db)  # projects bpm first, like the desktop's delete
        else:
            tcs = [dict(tc, start_time=float(tc["start_time"]), bpm=float(tc["bpm"])) for tc in value["tempo_changes"]]
            anchor = value.get("anchor_time")
            crud.update_beatgrid_tempo_changes(db, track.id, tcs, anchor_time=None if anchor is None else float(anchor))
        return
    if kind == "reset_marks":
        from . import crud

        crud.upsert_metric_ladder(db, track.id, [float(m) for m in value])
        return
    if value is None:
        setattr(track, kind, None)  # TrackChanges cannot clear; plain column write
        return
    apply_update(db, track, TrackChanges(**{kind: value}))


def read_setting(db: Session, key: str) -> tuple[Any, datetime | None]:
    """(current value — the user's, else the shipped default; when the user last set it)."""
    from .routers.device_sync import synced_settings

    entry = synced_settings(db)[key]
    row = db.get(AppSetting, key)
    return entry["value"], (row.updated_at if row is not None and entry["updated_at"] else None)


def write_setting(db: Session, key: str, value: Any) -> None:
    """Upsert the persisted value (the desktop frontend hydrates it on load). Caller commits."""
    if not isinstance(value, dict):
        raise FieldError(f"bad value for setting {key}: {value!r}")
    raw = json.dumps(value, separators=(",", ":"))
    stmt = sqlite_insert(AppSetting).values(key=key, value=raw)
    db.execute(stmt.on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": raw, "updated_at": _utcnow()}))


def read_any(db: Session, track: Track | None, field: str) -> tuple[Any, datetime | None]:
    key = setting_key(field)
    if key is not None:
        return read_setting(db, key)
    if track is None or track.archived_at is not None:
        raise FieldError("track not in library")
    return read_field(db, track, field)


def write_any(db: Session, track: Track | None, field: str, value: Any) -> None:
    key = setting_key(field)
    if key is not None:
        write_setting(db, key, value)
    elif track is not None:
        write_field(db, track, field, value)


# ── Push (phone → desktop) ─────────────────────────────────────────────


@dataclass
class PushedEdit:
    uuid: str
    track_id: int | None
    field: str
    old: Any
    new: Any
    edited_at_ms: int


def _dump(value: Any) -> str:
    return json.dumps(value)


def apply_edits(
    db: Session, device_id: str, device_name: str | None, edits: list[PushedEdit]
) -> tuple[str, dict[str, str]]:
    """Apply a pushed batch, oldest edit first. Returns (batch_id, uuid → outcome).
    Re-pushing an already-logged edit uuid is a no-op that reports the
    original outcome (the phone retries after a lost response)."""
    batch_id = uuid.uuid4().hex
    now = _utcnow()
    outcomes: dict[str, str] = {}
    for edit in sorted(edits, key=lambda e: e.edited_at_ms):
        prior = db.query(DeviceSyncChange).filter_by(edit_uuid=edit.uuid, direction="to_desktop").first()
        if prior is not None:
            outcomes[edit.uuid] = prior.outcome
            continue
        edited_at = min(datetime.fromtimestamp(edit.edited_at_ms / 1000, timezone.utc).replace(tzinfo=None), now)
        track = db.get(Track, edit.track_id) if edit.track_id is not None else None
        outcome = "rejected"
        old_logged = edit.old
        is_setting = edit.field.startswith(SETTING_PREFIX)
        try:
            current, changed_at = read_any(db, track, edit.field)
            old_logged = current
            if current == edit.new:
                outcome = "applied"  # already so
            elif current != edit.old and changed_at is not None and changed_at > edited_at:
                outcome = "superseded"  # the desktop changed it later: newest wins
            else:
                write_any(db, track, edit.field, edit.new)
                outcome = "applied"
        except FieldError:
            outcome = "rejected"
        db.add(DeviceSyncChange(
            batch_id=batch_id, device_id=device_id, device_name=device_name, direction="to_desktop",
            track_id=None if is_setting else edit.track_id, field=edit.field, old_json=_dump(old_logged), new_json=_dump(edit.new),
            edit_uuid=edit.uuid, edited_at=edited_at, synced_at=now, outcome=outcome,
        ))
        db.commit()
        outcomes[edit.uuid] = outcome
    return batch_id, outcomes


def log_received(db: Session, device_id: str, device_name: str | None, changes: list[dict]) -> str:
    """Record what a pull changed on the phone (direction to_phone)."""
    batch_id = uuid.uuid4().hex
    now = _utcnow()
    for c in changes:
        is_setting = setting_key(c["field"]) is not None
        if not is_setting:
            _parse_field(c["field"])
        db.add(DeviceSyncChange(
            batch_id=batch_id, device_id=device_id, device_name=device_name, direction="to_phone",
            track_id=None if is_setting else int(c["track_id"]), field=c["field"], old_json=_dump(c.get("old")),
            new_json=_dump(c.get("new")), synced_at=now, outcome="applied",
        ))
    db.commit()
    return batch_id


# ── Review + revert (desktop) ──────────────────────────────────────────


def change_row(c: DeviceSyncChange, titles: dict[int, str] | None = None) -> dict:
    return {
        "id": c.id, "batch_id": c.batch_id, "device_id": c.device_id, "device_name": c.device_name,
        "direction": c.direction, "track_id": c.track_id,
        "track_title": (titles or {}).get(c.track_id),
        "field": c.field, "old": json.loads(c.old_json) if c.old_json else None,
        "new": json.loads(c.new_json) if c.new_json else None,
        "edited_at": c.edited_at.isoformat() if c.edited_at else None,
        "synced_at": c.synced_at.isoformat(), "outcome": c.outcome,
        "reverts_id": c.reverts_id, "reverted_by_id": c.reverted_by_id,
        "revertable": c.outcome == "applied" and c.reverted_by_id is None and c.reverts_id is None,
    }


def list_changes(db: Session, limit: int = 300, device_id: str | None = None) -> list[dict]:
    q = db.query(DeviceSyncChange)
    if device_id:
        q = q.filter(DeviceSyncChange.device_id == device_id)
    rows = q.order_by(DeviceSyncChange.id.desc()).limit(limit).all()
    ids = {r.track_id for r in rows if r.track_id is not None}
    titles = {t.id: t.title or t.filename for t in db.query(Track).filter(Track.id.in_(ids))} if ids else {}
    tag_ids = {int(r.field[4:]) for r in rows if r.field.startswith("tag:")}
    tag_names = {t.id: t.name for t in db.query(Tag).filter(Tag.id.in_(tag_ids))} if tag_ids else {}
    link_ids = {int(r.field[5:]) for r in rows if r.field.startswith("link:")} - set(titles)
    if link_ids:
        titles |= {t.id: t.title or t.filename for t in db.query(Track).filter(Track.id.in_(link_ids))}
    out = []
    for r in rows:
        row = change_row(r, titles)
        if r.field.startswith("tag:"):
            row["tag_name"] = tag_names.get(int(r.field[4:]))
        if r.field.startswith("link:"):
            row["link_title"] = titles.get(int(r.field[5:]))
        out.append(row)
    return out


def revert(db: Session, change_ids: list[int]) -> list[DeviceSyncChange]:
    """Write each change's old value back on the desktop (newest first) and log it."""
    batch_id = uuid.uuid4().hex
    now = _utcnow()
    made = []
    rows = db.query(DeviceSyncChange).filter(DeviceSyncChange.id.in_(change_ids)).order_by(DeviceSyncChange.id.desc()).all()
    for c in rows:
        if c.outcome != "applied" or c.reverted_by_id is not None or c.reverts_id is not None:
            continue
        track = db.get(Track, c.track_id) if c.track_id is not None else None
        if track is None and not c.field.startswith(SETTING_PREFIX):
            continue
        old = json.loads(c.old_json) if c.old_json else None
        try:
            current, _ = read_any(db, track, c.field)
            write_any(db, track, c.field, old)
        except FieldError:
            continue
        r = DeviceSyncChange(
            batch_id=batch_id, device_id=DESKTOP, device_name="Revert", direction="to_desktop",
            track_id=c.track_id, field=c.field, old_json=_dump(current), new_json=_dump(old),
            edited_at=now, synced_at=now, outcome="applied", reverts_id=c.id,
        )
        db.add(r)
        db.flush()
        c.reverted_by_id = r.id
        made.append(r)
    db.commit()
    return made


def revert_batch(db: Session, batch_id: str) -> list[DeviceSyncChange]:
    ids = [c.id for c in db.query(DeviceSyncChange.id).filter(DeviceSyncChange.batch_id == batch_id)]
    return revert(db, ids)


__all__ = [
    "PushedEdit", "apply_edits", "log_received", "list_changes", "revert", "revert_batch",
    "read_field", "write_field", "read_setting", "write_setting", "FieldError",
]

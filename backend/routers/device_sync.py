"""Device sync (#372): a phone pulls a read-only Library snapshot.

Pull-only v1 per docs/research/mobile-sync-protocol.md: the desktop stays
authoritative; the device caches the snapshot, preview waveforms and audio
and works offline from them. Everything a device needs lives under this
prefix so a future LAN listener can expose it alone.

- GET  /snapshot              Tracks, Tags, Playlists, cues, grids, Follow evidence edges
- POST /previews              bulk preview-waveform pack (MPK1, see below)
- GET  /tracks/{id}/audio     the audio file (Range-capable)
- GET  /tracks/{id}/waveform  the full detail waveform (MWF1), with `waveform_rev`
- GET  /tracks/{id}/stems/{stem}           one current stem (AAC m4a, Range), `stems_rev`
- GET  /tracks/{id}/stems/{stem}/waveform  that stem's MWF1 (generated lazily)

The snapshot also carries `settings`: synced performance settings
(SYNCED_SETTINGS: Waveform style slots, filter) so the phone plays with the
desktop's palette and filter.

Revisions let the device skip unchanged artifacts: `audio_rev` changes when
the file's path/size/mtime does; `preview_rev` when the preview blob does.
Follow evidence ships as raw aggregated edges — the device ranks locally
(Known/Observed/Compatible), as the desktop Follow mode does in the browser.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import struct
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload, undefer

from .. import shipped_defaults
from ..database import get_db
from ..key import Key
from ..models import (
    AppSetting,
    Beatgrid,
    Cameo,
    HotCue,
    MetricLadder,
    Playlist,
    PlaylistTrack,
    Tag,
    TagCategory,
    Take,
    Track,
    TrackLink,
    Transition,
    Waveform,
)

router = APIRouter()

SNAPSHOT_VERSION = 1
PACK_MAGIC = b"MPK1"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def audio_rev(filename: str) -> str | None:
    """Identity of the audio bytes the device would cache, or None when the
    file is missing. Path + size + mtime: cheap, and any replacement of the
    file changes it (content hashing a whole Library is not)."""
    try:
        st = Path(filename).stat()
    except OSError:
        return None
    raw = f"{filename}\0{st.st_size}\0{st.st_mtime_ns}".encode()
    return hashlib.sha1(raw).hexdigest()[:16]


def preview_rev(blob: bytes) -> str:
    return hashlib.sha1(blob).hexdigest()[:16]


def _key_fields(engine_id: int | None) -> dict:
    key = Key.from_engine_id(engine_id)
    if key is None:
        return {"key": None, "key_openkey": None, "key_camelot": None}
    return {"key": engine_id, "key_openkey": key.openkey, "key_camelot": key.camelot}


def _preview_revs(db: Session) -> dict[int, str]:
    rows = db.execute(
        select(Waveform.track_id, Waveform.preview_blob).where(Waveform.preview_blob.is_not(None))
    ).all()
    return {track_id: preview_rev(blob) for track_id, blob in rows}


def _waveform_revs(db: Session) -> dict[int, str]:
    """Full detail waveform (MWF1 data blob) revisions, without reading blobs:
    the row id + updated_at change whenever the blob is regenerated."""
    rows = db.execute(
        select(Waveform.track_id, Waveform.id, Waveform.updated_at).where(Waveform.data_blob.is_not(None))
    ).all()
    return {
        track_id: hashlib.sha1(f"{wid}:{updated.isoformat() if updated else ''}".encode()).hexdigest()[:16]
        for track_id, wid, updated in rows
    }


# Synced performance settings (settings #176 keys): the phone plays with the
# desktop's look and feel. Values are the parsed JSON the frontend persists.
SYNCED_SETTINGS: tuple[str, ...] = ("manadj.waveformStyles", "manadj-filter-settings", "manadj-follow-params")


def _json_object(raw: str | None) -> dict | None:
    try:
        value = json.loads(raw) if raw else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def synced_settings(db: Session) -> dict[str, dict]:
    """key -> {value, updated_at}: the user's value, else the shipped default
    (updated_at null). An unparseable user value falls back to the default."""
    rows = {r.key: r for r in db.query(AppSetting).filter(AppSetting.key.in_(SYNCED_SETTINGS))}
    shipped = shipped_defaults.shipped_settings()
    out: dict[str, dict] = {}
    for key in SYNCED_SETTINGS:
        row = rows.get(key)
        value = _json_object(row.value) if row else None
        if value is not None:
            out[key] = {"value": value, "updated_at": _iso(row.updated_at)}
        else:
            out[key] = {"value": _json_object(shipped.get(key)), "updated_at": None}
    return out


def stems_rev(track_id: int, filename: str) -> str | None:
    """Revision of a Track's current stems (stale = absent, #149): changes
    with the split (meta.json) — null when there are none."""
    from ..stems import META_FILENAME, is_current, stems_dir

    try:
        if not is_current(track_id, Path(filename)):
            return None
        meta = (stems_dir(track_id) / META_FILENAME).read_bytes()
    except OSError:
        return None
    return hashlib.sha1(meta).hexdigest()[:16]


def build_snapshot(db: Session) -> dict:
    tracks = (
        db.query(Track)
        .filter(Track.archived_at.is_(None))
        .options(selectinload(Track.beatgrid), selectinload(Track.track_tags))
        .order_by(Track.created_at.desc(), Track.id.desc())
        .all()
    )
    ids = {t.id for t in tracks}

    cues: dict[int, list[dict]] = defaultdict(list)
    for cue in db.query(HotCue).order_by(HotCue.track_id, HotCue.slot_number):
        if cue.track_id in ids:
            cues[cue.track_id].append(
                {"slot": cue.slot_number, "time": cue.time_seconds, "label": cue.label, "color": cue.color}
            )

    previews = _preview_revs(db)
    waveforms = _waveform_revs(db)
    ladders = {
        lad.track_id: {"arities": json.loads(lad.arities_json), "reset_marks": json.loads(lad.reset_marks_json)}
        for lad in db.query(MetricLadder)
    }

    track_rows = []
    for t in tracks:
        grid = None
        bg: Beatgrid | None = t.beatgrid
        if bg is not None and bg.origin != "generated":
            grid = {
                "origin": bg.origin,
                "anchor_time": bg.anchor_time,
                "tempo_changes": json.loads(bg.tempo_changes_json),
            }
        track_rows.append(
            {
                "id": t.id,
                "title": t.title,
                "artist": t.artist,
                "file_name": Path(t.filename).name,
                "bpm": t.bpm_projected,
                # The centiBPM column desktop Follow's BPM gate filters on (crud.get_tracks):
                # can differ from the served bpm (ADR 0027); the phone gates on it for parity.
                "bpm_centi": t.bpm,
                **_key_fields(t.key),
                "energy": t.energy,
                "duration_secs": t.duration_secs,
                "date_added": _iso(t.created_at),
                "main_cue": t.cue_point_time,
                "codec": t.codec,
                "filesize_bytes": t.filesize_bytes,
                "audio_rev": audio_rev(t.filename),
                "preview_rev": previews.get(t.id),
                "waveform_rev": waveforms.get(t.id),
                "stems_rev": stems_rev(t.id, t.filename),
                "tag_ids": sorted(tt.tag_id for tt in t.track_tags),
                "hot_cues": cues.get(t.id, []),
                "grid": grid,
                "metric_ladder": ladders.get(t.id),
            }
        )

    categories = [
        {"id": c.id, "name": c.name, "display_order": c.display_order, "color": c.color}
        for c in db.query(TagCategory).order_by(TagCategory.display_order, TagCategory.id)
    ]
    tags = [
        {
            "id": tag.id,
            "name": tag.name,
            "category_id": tag.category_id,
            "display_order": tag.display_order,
            "color": tag.color,
        }
        for tag in db.query(Tag).order_by(Tag.category_id, Tag.display_order, Tag.id)
    ]

    def both_known(a: int, b: int) -> bool:
        return a in ids and b in ids

    links = [
        [lo, hi]
        for lo, hi in db.execute(select(TrackLink.low_track_id, TrackLink.high_track_id))
        if both_known(lo, hi)
    ]

    def pair_edges(a_col, b_col, model) -> list[dict]:
        rows = db.execute(
            select(a_col, b_col, func.count(), func.max(model.favorite)).group_by(a_col, b_col)
        ).all()
        return [
            {"a": a, "b": b, "count": n, "favorite": bool(fav)}
            for a, b, n, fav in rows
            if both_known(a, b)
        ]

    transitions = pair_edges(Transition.a_track_id, Transition.b_track_id, Transition)
    cameos = [
        {"host": e["a"], "guest": e["b"], "count": e["count"], "favorite": e["favorite"]}
        for e in pair_edges(Cameo.host_track_id, Cameo.guest_track_id, Cameo)
    ]

    # Observed raw material: handover Takes per ordered pair. The device
    # applies the Take-count floor and the "nothing curated" exclusion —
    # both are tunable heuristics (CONTEXT.md: Observed). Cameo Takes count
    # for nothing in discovery.
    take_rows = db.execute(
        select(Take.a_track_id, Take.b_track_id, func.count(), func.max(Take.detected_at))
        .where(Take.kind == "handover", Take.a_track_id != Take.b_track_id)
        .group_by(Take.a_track_id, Take.b_track_id)
    ).all()
    takes = [
        {"a": a, "b": b, "count": n, "last_at": _iso(last)}
        for a, b, n, last in take_rows
        if both_known(a, b)
    ]

    # Playlists (flat on the desktop — no folders) with members in Play order.
    members: dict[int, list[int]] = defaultdict(list)
    for playlist_id, track_id in db.execute(
        select(PlaylistTrack.playlist_id, PlaylistTrack.track_id).order_by(
            PlaylistTrack.playlist_id, PlaylistTrack.position
        )
    ):
        if track_id in ids:
            members[playlist_id].append(track_id)
    playlists = [
        {
            "id": p.id,
            "name": p.name,
            "color": p.color,
            "display_order": p.display_order,
            "track_ids": members.get(p.id, []),
        }
        for p in db.query(Playlist).order_by(Playlist.display_order, Playlist.id)
    ]

    return {
        "version": SNAPSHOT_VERSION,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "tag_categories": categories,
        "tags": tags,
        "tracks": track_rows,
        "playlists": playlists,
        "links": links,
        "transitions": transitions,
        "cameos": cameos,
        "takes": takes,
        "settings": synced_settings(db),
    }


@router.get("/snapshot")
def get_snapshot(db: Session = Depends(get_db)):
    return build_snapshot(db)


class PreviewRequest(BaseModel):
    track_ids: list[int]


def pack_previews(entries: list[tuple[int, bytes]]) -> bytes:
    """MPK1 pack: magic, u32 count, then per entry u32 track_id, u32 length,
    the MWF1 preview blob. Little-endian."""
    parts = [PACK_MAGIC, struct.pack("<I", len(entries))]
    for track_id, blob in entries:
        parts.append(struct.pack("<II", track_id, len(blob)))
        parts.append(blob)
    return b"".join(parts)


@router.post("/previews")
def get_previews(request: PreviewRequest, db: Session = Depends(get_db)):
    """Preview waveforms for the requested Tracks; Tracks without a
    generated preview are omitted (the device retries on its next sync)."""
    wanted = set(request.track_ids)
    entries: list[tuple[int, bytes]] = []
    if wanted:
        rows = (
            db.query(Waveform.track_id, Waveform)
            .options(undefer(Waveform.preview_blob))
            .filter(Waveform.track_id.in_(wanted), Waveform.preview_blob.is_not(None))
            .order_by(Waveform.track_id)
            .all()
        )
        entries = [(track_id, wf.preview_blob) for track_id, wf in rows]
    return Response(content=pack_previews(entries), media_type="application/octet-stream")


@router.get("/tracks/{track_id}/waveform")
def get_detail_waveform(track_id: int, db: Session = Depends(get_db)):
    """The full detail waveform the desktop renders (MWF1 data blob, ADR 0014),
    so the phone never re-analyzes synced tracks. 404 until generated."""
    row = db.execute(
        select(Waveform.id, Waveform.updated_at, Waveform.data_blob).where(Waveform.track_id == track_id)
    ).first()
    if row is None or row.data_blob is None:
        raise HTTPException(status_code=404, detail="Waveform not generated yet")
    rev = hashlib.sha1(f"{row.id}:{row.updated_at.isoformat() if row.updated_at else ''}".encode()).hexdigest()[:16]
    return Response(content=row.data_blob, media_type="application/octet-stream", headers={"X-Waveform-Rev": rev})


@router.get("/tracks/{track_id}/audio")
def get_audio(track_id: int, db: Session = Depends(get_db)):
    track = db.get(Track, track_id)
    if track is None or track.archived_at is not None:
        raise HTTPException(status_code=404, detail="Track not found")
    path = Path(track.filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    mime, _ = mimetypes.guess_type(str(path))
    response = FileResponse(path, media_type=mime or "audio/mpeg", filename=path.name)
    rev = audio_rev(track.filename)
    if rev:
        response.headers["X-Audio-Rev"] = rev
    return response


def _current_stem(db: Session, track_id: int, stem: str) -> Path:
    from ..stems import STEM_NAMES, is_current, stems_dir

    track = db.get(Track, track_id)
    if stem not in STEM_NAMES or track is None or track.archived_at is not None:
        raise HTTPException(status_code=404, detail="Unknown track or stem")
    if not is_current(track_id, Path(track.filename)):
        raise HTTPException(status_code=404, detail="Stems not available")
    return stems_dir(track_id) / f"{stem}.m4a"


@router.get("/tracks/{track_id}/stems/{stem}")
def get_stem(track_id: int, stem: str, db: Session = Depends(get_db)):
    """One current stem (vocals/drums/bass/other) as AAC m4a, Range-capable."""
    path = _current_stem(db, track_id, stem)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stems not available")
    response = FileResponse(path, media_type="audio/mp4", filename=f"{track_id}-{stem}.m4a")
    rev = stems_rev(track_id, db.get(Track, track_id).filename)
    if rev:
        response.headers["X-Stems-Rev"] = rev
    return response


@router.get("/tracks/{track_id}/stems/{stem}/waveform")
def get_stem_waveform(track_id: int, stem: str, db: Session = Depends(get_db)):
    """That stem's MWF1 waveform (generated on first request, ~1.5 s)."""
    from ..stems import ensure_stem_waveform

    _current_stem(db, track_id, stem)
    try:
        path = ensure_stem_waveform(track_id, stem)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Stems not available")
    return FileResponse(path, media_type="application/octet-stream")


__all__ = ["router", "build_snapshot", "pack_previews", "audio_rev"]


# ── Sessions (#378): the phone replays desktop Sessions ───────────────


@router.get("/sessions")
def list_device_sessions(db: Session = Depends(get_db)):
    """Session headers, newest first (the desktop Sessions list). Event logs
    are fetched per Session on demand: they are large and immutable once
    ended, so the phone caches them by uuid."""
    from . import sessions as sessions_router

    return [row.model_dump(mode="json") for row in sessions_router.list_sessions(db)]


@router.get("/sessions/{uuid}")
def get_device_session(uuid: str, db: Session = Depends(get_db)):
    """One Session's capture-event log (SessionDetail) for replay. scratchMove
    samples are dropped: the phone has no scratch engine (scratchBegin/End
    stay as landings), and they are most of a scratch-heavy log's bytes
    (81 MB -> 3 MB on a real Session)."""
    from . import sessions as sessions_router

    detail = sessions_router.get_session(uuid, db).model_dump(mode="json")
    detail["events"] = [
        e for e in detail["events"]
        if not (e.get("kind") == "transport" and e.get("action") == "scratchMove")
    ]
    return detail


# ── Phone → desktop (ADR 0045, #375) ──────────────────────────────────


class EditIn(BaseModel):
    uuid: str
    track_id: int | None = None  # null for setting:<key>
    field: str
    old: object = None
    new: object = None
    edited_at_ms: int


class EditsIn(BaseModel):
    edits: list[EditIn]


class ReceivedIn(BaseModel):
    changes: list[dict]


def _device(request: Request) -> tuple[str, str | None]:
    """The Paired device (LAN listener sets it); over loopback (adb reverse)
    the phone names itself via headers."""
    device = getattr(request.state, "device", None)
    if device is not None:
        return device
    return (
        request.headers.get("X-Manadj-Device-Id") or "loopback",
        request.headers.get("X-Manadj-Device-Name"),
    )


@router.post("/edits")
def push_edits(body: EditsIn, request: Request, db: Session = Depends(get_db)):
    """Apply journaled phone edits newest-wins; one Device change log batch."""
    from ..device_edits import PushedEdit, apply_edits

    device_id, name = _device(request)
    batch, outcomes = apply_edits(
        db, device_id, name,
        [PushedEdit(e.uuid, e.track_id, e.field, e.old, e.new, e.edited_at_ms) for e in body.edits],
    )
    return {"batch_id": batch, "outcomes": outcomes}


@router.post("/received")
def report_received(body: ReceivedIn, request: Request, db: Session = Depends(get_db)):
    """The phone's diff after a pull: what desktop changes reached it."""
    from ..device_edits import FieldError, log_received

    device_id, name = _device(request)
    try:
        batch = log_received(db, device_id, name, body.changes) if body.changes else None
    except (FieldError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"batch_id": batch}

"""Versioned read-only paired-device adapter; no local-control mutations."""
import json

from fastapi import HTTPException
from sqlalchemy import func, select

from ..models import HotCue, Session, Track
from ..session_source import peer_audio, replay_generation
from .contracts import Manifest
from .models import SyncConflict, SyncSession
from .service import PeerSync, SyncError


def item(db, stored):
    sid = stored.session_uuid
    normal = db.scalar(select(Session).where(Session.uuid == sid))
    projection = normal.peer_history if normal is not None else None
    result = {
        "session_uuid": sid, "origin_replica_id": stored.origin_replica_id,
        "recording_origin": None, "manifest_sha256": stored.manifest_sha256,
        "started_at": None, "ended_at": None,
        "materialized": projection is not None, "state": "source_invalid", "replay_generation": None,
        "dependencies": [], "conflict_count": db.scalar(select(func.count()).select_from(SyncConflict).where(SyncConflict.session_uuid == sid)),
    }
    try:
        manifest = Manifest.model_validate_json(stored.manifest_json)
        result.update(recording_origin=manifest.recording_origin, started_at=manifest.started_at.isoformat(), ended_at=manifest.ended_at.isoformat())
        service = PeerSync(db)
        detail = service.detail(sid)
        refs = {str(ref.logical_track_id): ref for ref in manifest.tracks}
        result["dependencies"] = [{**d,
            "sha256": refs[d["logical_track_id"]].asset.sha256 if refs[d["logical_track_id"]].asset else None,
            "byte_length": refs[d["logical_track_id"]].asset.byte_length if refs[d["logical_track_id"]].asset else None,
        } for d in detail["dependencies"]]
        result["state"] = detail["state"]
        if detail["dependencies_ready"]:
            if projection is None:
                result["state"] = "not_materialized"
            elif (projection.source_sha256 != stored.manifest_sha256
                    or projection.binding_sha256 != service.binding_generation(sid)):
                result["state"] = "stale_binding"
            else:
                result["state"] = "ready"
                result["replay_generation"] = replay_generation(normal)
    except (SyncError, ValueError, TypeError, KeyError):
        result["state"] = "source_invalid"
        result["replay_generation"] = None
    return result


def list_peer_sessions(db):
    rows = db.scalars(select(SyncSession).where(SyncSession.direction == "received").order_by(SyncSession.session_uuid)).all()
    return {"version": 1, "items": [item(db, stored) for stored in rows]}


def require_ready(db, sid, generation):
    stored = db.get(SyncSession, str(sid))
    if stored is None or stored.direction != "received":
        raise HTTPException(404, "peer_history_not_found")
    status = item(db, stored)
    if not status["materialized"]:
        raise HTTPException(404, "peer_history_not_materialized")
    if status["state"] != "ready" or status["replay_generation"] != generation:
        raise HTTPException(409, "peer_history_unavailable_or_stale_generation")
    normal = db.scalar(select(Session).where(Session.uuid == str(sid)))
    return normal, status


def track_metadata(db, track):
    # Fresh selected-row facts only. No LibraryStore/snapshot lookup by bare ID,
    # no stems substitution or legacy audio_rev authority over exact bytes.
    from ..routers.device_sync import audio_rev
    grid = track.beatgrid
    return {
        "id": track.id, "title": track.title, "artist": track.artist, "bpm": track.bpm_projected,
        "duration_secs": track.duration_secs, "main_cue": track.cue_point_time,
        "audio_rev": audio_rev(track.filename),
        "grid": {"origin": grid.origin, "anchor_time": grid.anchor_time,
                 "tempo_changes": json.loads(grid.tempo_changes_json)} if grid is not None and grid.origin != "generated" else None,
        "hot_cues": [{"slot": c.slot_number, "time": c.time_seconds, "label": c.label, "color": c.color}
                     for c in db.scalars(select(HotCue).where(HotCue.track_id == track.id).order_by(HotCue.slot_number))],
    }


def peer_session(db, sid, generation):
    normal, status = require_ready(db, sid, generation)
    from ..routers.sessions import get_session
    tracks = [{"local_track_id": d["local_track_id"], "logical_track_id": d["logical_track_id"],
               "sha256": d["sha256"], "byte_length": d["byte_length"],
               "track": track_metadata(db, db.get(Track, d["local_track_id"]))} for d in status["dependencies"]]
    return {"version": 1, "item": status, "session": get_session(normal.uuid, db).model_dump(mode="json"), "tracks": tracks}


def audio(db, sid, track_id, generation):
    normal, _ = require_ready(db, sid, generation)
    return peer_audio(db, normal, track_id, generation)

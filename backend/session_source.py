"""One guarded event reader for local logs and immutable peer projections.

Peer projections never contain compiled local-ID chunks. Every reader resolves
the source again; a binding incarnation change requires explicit rematerialization.
"""
import json
import hashlib
from pathlib import Path

from fastapi import HTTPException

from .peer_sync.service import PeerSync, SyncError
from .peer_sync.contracts import Manifest, digest
from .peer_sync.models import SyncSession


def deny_peer_write(session):
    if session is not None and session.peer_history is not None:
        raise HTTPException(409, "peer_history_is_immutable")


def deny_peer_derivation(db, uuid):
    from .models import Session
    session = db.query(Session).filter(Session.uuid == uuid).first() if uuid else None
    if session is not None and session.peer_history is not None:
        raise HTTPException(409, "peer_history_saved_derivation_not_supported")


def peer_detail(db, session):
    projection = session.peer_history
    try:
        service = PeerSync(db)
        detail = service.detail(session.uuid)
        if (not detail["dependencies_ready"] or detail["manifest_sha256"] != projection.source_sha256
                or service.binding_generation(session.uuid) != projection.binding_sha256):
            raise HTTPException(409, "peer_history_dependencies_or_binding_changed")
        return detail
    except (SyncError, ValueError, TypeError, KeyError) as error:
        raise HTTPException(409, "peer_history_source_unavailable") from error


def session_events(db, session):
    if session.peer_history is not None:
        return peer_detail(db, session)["session"]["events"]
    return [event for chunk in session.chunks for event in json.loads(chunk.events_json)]


def replay_generation(session):
    projection = session.peer_history
    return digest([projection.source_sha256, projection.binding_sha256]) if projection is not None else None


def preview_source(db, uuid):
    from .models import Session
    session = db.query(Session).filter(Session.uuid == uuid).first()
    if session is None or session.peer_history is None:
        return None
    peer_detail(db, session)
    return {"session_uuid": uuid, "generation": replay_generation(session)}


def peer_audio(db, session, track_id, generation):
    from .models import Track
    detail = peer_detail(db, session)
    if generation != replay_generation(session):
        raise HTTPException(409, "stale_peer_replay_generation")
    logical = next((d["logical_track_id"] for d in detail["dependencies"] if d["local_track_id"] == track_id), None)
    if logical is None:
        raise HTTPException(409, "track_not_in_peer_source")
    manifest = Manifest.model_validate_json(db.get(SyncSession, session.uuid).manifest_json)
    asset = next(ref.asset for ref in manifest.tracks if str(ref.logical_track_id) == logical)
    track = db.get(Track, track_id)
    try:
        with Path(track.filename).open("rb") as source:
            data = source.read(asset.byte_length + 1)
    except OSError as error:
        raise HTTPException(409, "peer_audio_unavailable") from error
    if len(data) != asset.byte_length or hashlib.sha256(data).hexdigest() != asset.sha256:
        raise HTTPException(409, "peer_audio_version_changed")
    # Return the verified bytes themselves, not a FileResponse reopening a mutable path.
    return data

"""Public native provisioning export from already pinned local enrollment.

No enrollment, key generation, HTTP or automatic track matching. The caller must
supply explicit phone-local IDs for selected logical tracks, after comparing
content on that device. Native import independently hashes the actual bytes.
"""
import base64
import hashlib
import os
from pathlib import Path

from sqlalchemy import select

from backend.models import Track
from backend.peer_sync.models import GroupMember, SyncTrack
from .service import Replica, SyncFailure, uuid


def native_configuration(db, group_id, target_origin, local_ids):
    group_id, target_origin = uuid(group_id), uuid(target_origin)
    if not isinstance(local_ids, dict) or not 1 <= len(local_ids) <= 25:
        raise SyncFailure('select_one_to_25_tracks')
    if any(type(value) is not int or value <= 0 for value in local_ids.values()) or len(set(local_ids.values())) != len(local_ids):
        raise SyncFailure('unique_positive_phone_ids_required')
    Replica(db, group_id)._local()
    members = list(db.scalars(select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.revoked == 0).order_by(GroupMember.device_id)))
    if not 2 <= len(members) <= 3 or target_origin not in {member.device_id for member in members}:
        raise SyncFailure('target_must_be_locally_pinned')
    pins = []
    for member in members:
        try:
            raw = base64.b64decode(member.public_key_b64, validate=True)
            if len(raw) != 32:
                raise ValueError()
        except ValueError as error:
            raise SyncFailure('invalid_public_pin') from error
        pins.append({'origin': member.device_id, 'publicKey': member.public_key_b64})
    bindings = []
    for logical_id, phone_id in sorted(local_ids.items()):
        logical_id = uuid(logical_id)
        binding = db.get(SyncTrack, logical_id)
        track = db.get(Track, binding.track_id) if binding and binding.track_id else None
        if track is None or track.archived_at is not None:
            raise SyncFailure('selected_track_unavailable')
        path = Path(track.filename)
        if not path.is_file() or path.is_symlink():
            raise SyncFailure('selected_audio_unavailable')
        digest, length = hashlib.sha256(), 0
        with path.open('rb') as source:
            descriptor = source.fileno()
            stat_before = os.fstat(descriptor)
            while chunk := source.read(1024 * 1024):
                digest.update(chunk); length += len(chunk)
            stat_after = os.fstat(descriptor)
        current = path.stat()
        stamp = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if length <= 0 or stamp(stat_before) != stamp(stat_after) or stamp(stat_after) != stamp(current) or length != current.st_size:
            raise SyncFailure('selected_audio_changed')
        bindings.append({'logicalID': logical_id, 'localID': phone_id, 'contentSHA256': digest.hexdigest(), 'byteLength': length})
    return {'version': 1, 'group': group_id, 'origin': target_origin, 'members': pins, 'bindings': bindings}

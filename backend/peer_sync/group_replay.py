"""Explicit replica-local selection; signed metadata never locates receiver audio.

Only immutable bytes read from a current selected file reach the decoder. No
server state, including candidate-exact, asserts that an engine decoded them.
"""
import hashlib
import os
import stat
from pathlib import Path
from uuid import UUID, uuid4

from ..models import Track
from .contracts import Asset, digest
from .events import remap
from .group import GroupSync
from .group_history import received_operations, verified_operation, views
from .models import DeviceGroup, GroupReplayBinding, GroupReplaySelection, SyncSelection
from .replay_contracts import (
    REPLAY_GRAMMAR,
    ReceiverSelection,
    ReplayBinding,
    ReplayIdentity,
    ReplayReadiness,
    replay_generation,
    supports_replay_events,
)
from .service import PeerSync, SyncError

MAX_AUDIO = 512 * 1024 * 1024


def file_facts(value):
    if not stat.S_ISREG(value.st_mode) or not value.st_ino or not hasattr(value, "st_ctime_ns"):
        raise SyncError(409, "unsupported-identity")
    # Nanoseconds are NOT portable JCS numbers.
    return [str(getattr(value, field)) for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")]


def read_selected(track, guard):
    if track is None or track.archived_at is not None or guard is None:
        raise SyncError(409, "stale-selection")
    try:
        if not hasattr(os, "O_NONBLOCK"):
            raise SyncError(409, "unsupported-identity")
        # A selected pathname can be replaced by a FIFO/device. Never block
        # opening it before discovering that it no longer has regular identity.
        with os.fdopen(os.open(track.filename, os.O_RDONLY | os.O_NONBLOCK), "rb") as stream:
            before = os.fstat(stream.fileno())
            facts = file_facts(before)
            if not 0 < before.st_size <= MAX_AUDIO:
                raise SyncError(409, "partial")
            data = stream.read(before.st_size + 1)
            if (len(data) != before.st_size or file_facts(os.fstat(stream.fileno())) != facts
                    or file_facts(Path(track.filename).stat()) != facts):
                raise SyncError(409, "changed")
        incarnation = digest({"guard": guard, "facts": facts})
        return data, incarnation, Asset(algorithm="sha256-file-bytes-v1", sha256=hashlib.sha256(data).hexdigest(), byte_length=len(data))
    except FileNotFoundError:
        raise SyncError(409, "missing") from None
    except OSError:
        raise SyncError(503, "error") from None


class GroupReplay:
    def __init__(self, db):
        self.db = db

    def select(self, local_id, body=None):
        peer = PeerSync(self.db)
        peer._lock()
        track = peer._track(local_id)
        if self.db.get(SyncSelection, local_id) is None:
            self.db.add(SyncSelection(track_id=local_id, token=uuid4().hex))
            self.db.flush()
        _, incarnation, asset = read_selected(track, peer._guard(track))
        row = GroupReplaySelection(selection_id=str(uuid4()), track_id=local_id, incarnation=incarnation,
                                   asset_json=asset.model_dump_json())
        self.db.add(row)
        result = ReceiverSelection(format="manadj-group-receiver-selection/v1", selection_id=UUID(row.selection_id),
            receiver_key=str(local_id), incarnation=incarnation, label=(track.title or "Selected local Track")[:160], asset=asset)
        self.db.commit()
        return result

    def source(self, gid, oid):
        group = GroupSync(self.db, gid)
        group._local()
        row = group._operation(oid)
        if row is None:
            raise SyncError(409, "invalid")
        operation = verified_operation(self.db, row)
        claims = received_operations(self.db, row.session_uuid)
        if not any(c.group_id == str(gid) and c.operation_id == str(oid) and not c.missing for c in claims):
            raise SyncError(409, "invalid")
        candidates = views(self.db, row.session_uuid)
        view = next((v for v in candidates if str(v.group_id) == str(gid) and str(v.operation_id) == str(oid)), None)
        if view is None:
            raise SyncError(409, "invalid")
        if view.status in {"revoked", "invalid", "conflicted", "projection-pending"}:
            raise SyncError(409, view.status)
        events = [event for chunk in sorted(operation.bundle.chunks, key=lambda c: c.seq) for event in chunk.events]
        if not supports_replay_events(events):
            raise SyncError(409, "unsupported-grammar")
        return row, operation, events

    def selected(self, row):
        if row is None:
            raise SyncError(409, "stale-selection")
        peer = PeerSync(self.db)
        track = self.db.get(Track, row.track_id)
        data, incarnation, asset = read_selected(track, peer._guard(track) if track else None)
        if incarnation != row.incarnation:
            raise SyncError(409, "stale-selection")
        if asset != Asset.model_validate_json(row.asset_json):
            raise SyncError(409, "changed")
        return data, asset

    def bind(self, gid, oid, body):
        PeerSync(self.db)._lock()
        source, operation, _ = self.source(gid, oid)
        ref = next((ref for ref in operation.bundle.manifest.tracks if ref.logical_track_id == body.logical_track_id), None)
        if ref is None or ref.asset is None:
            raise SyncError(409, "unverified")
        selection = self.db.get(GroupReplaySelection, str(body.selection_id))
        _, asset = self.selected(selection)
        if selection.incarnation != body.incarnation:
            raise SyncError(409, "stale-selection")
        if asset != ref.asset:
            raise SyncError(409, "changed")
        key = (str(gid), str(oid), str(body.logical_track_id))
        binding = self.db.get(GroupReplayBinding, key)
        if binding is None:
            binding = GroupReplayBinding(group_id=key[0], operation_id=key[1], logical_track_id=key[2])
            self.db.add(binding)
        binding.operation_sha256 = source.sha256
        binding.selection_id = selection.selection_id
        binding.incarnation = selection.incarnation
        self.db.commit()
        return self.readiness(gid, oid)

    def _candidate(self, gid, oid, retain_audio=None):
        row, operation, events = self.source(gid, oid)
        bindings, audio, mapping, selected = [], {}, {}, []
        for ref in operation.bundle.manifest.tracks:
            if ref.asset is None:
                raise SyncError(409, "unverified")
            binding = self.db.get(GroupReplayBinding, (str(gid), str(oid), str(ref.logical_track_id)))
            if binding is None:
                raise SyncError(409, "unbound")
            if binding.operation_sha256 != row.sha256:
                raise SyncError(409, "invalid")
            selection = self.db.get(GroupReplaySelection, binding.selection_id) if binding.selection_id else None
            data, asset = self.selected(selection)
            if binding.incarnation != selection.incarnation:
                raise SyncError(409, "stale-selection")
            if asset != ref.asset:
                raise SyncError(409, "changed")
            bindings.append(ReplayBinding(logical_track_id=ref.logical_track_id, selection_id=UUID(selection.selection_id),
                receiver_key=str(selection.track_id), incarnation=selection.incarnation, asset=asset))
            if str(ref.logical_track_id) == retain_audio:
                audio[str(ref.logical_track_id)] = data
            selected.append(selection)
            mapping[ref.source_local_id] = selection.track_id
        # A later Track's hash must not mask replacement of an earlier file.
        for selection in selected:
            track = self.db.get(Track, selection.track_id)
            try:
                current = digest({"guard": PeerSync(self.db)._guard(track), "facts": file_facts(Path(track.filename).stat())})
            except OSError:
                raise SyncError(409, "missing") from None
            if current != selection.incarnation:
                raise SyncError(409, "stale-selection")
        identity = ReplayIdentity(group_id=UUID(str(gid)), operation_id=UUID(str(oid)), operation_sha256=row.sha256,
            session_uuid=operation.bundle.manifest.session_uuid, origin_device_id=operation.origin_device_id,
            receiver_device_id=UUID(self.db.get(DeviceGroup, str(gid)).device_id))
        return identity, bindings, audio, remap(events, mapping)

    def readiness(self, gid, oid):
        # Inspectable identity on a refusal grants nothing.
        group = self.db.get(DeviceGroup, str(gid))
        row = GroupSync(self.db, gid)._operation(oid)
        if row is None or group is None:
            raise SyncError(404, "group_replay_source_missing")
        identity = ReplayIdentity(group_id=UUID(str(gid)), operation_id=UUID(str(oid)), operation_sha256=row.sha256,
            session_uuid=UUID(row.session_uuid), origin_device_id=UUID(row.origin_device_id), receiver_device_id=UUID(group.device_id))
        try:
            identity, bindings, _, _ = self._candidate(gid, oid)
            state, reason, generation = "candidate-exact", None, replay_generation(identity, bindings)
        except SyncError as error:
            state = {"unknown_or_revoked_group_member": "revoked", "unknown_device_group": "revoked"}.get(error.code, error.code)
            if state not in ReplayReadiness.model_fields["state"].annotation.__args__:
                state = "invalid"
            reason, generation, bindings = error.code[:160], None, []
        return ReplayReadiness(format="manadj-group-replay-readiness/v1", identity=identity, grammar=REPLAY_GRAMMAR,
            state=state, generation=generation, bindings=bindings, reason=reason, playable=False)

    def replay(self, gid, oid, generation, logical=None):
        identity, bindings, audio, events = self._candidate(gid, oid, str(logical) if logical is not None else None)
        if replay_generation(identity, bindings) != generation:
            raise SyncError(409, "stale_group_replay_generation")
        if logical is not None:
            if str(logical) not in audio:
                raise SyncError(404, "unbound")
            return audio[str(logical)]  # verified bytes, NOT a reopened filename
        return {"format": "manadj-group-replay-source/v1", "identity": identity, "grammar": REPLAY_GRAMMAR,
                "generation": generation, "bindings": bindings, "events": events, "playable": False}

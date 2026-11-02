"""Transactional own-machine outbox/inbox. No normal history mutation or network effects."""
import hashlib
import json
import os
from datetime import timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select, text

from ..models import Session as RecordedSession
from ..models import Track
from ..peer_inventory.contracts import MAX_EXPORT, canonical
from ..session_audibility import events_contain_audible
from .contracts import Asset, Bundle, Chunk, Manifest, TrackReference, digest
from .events import reference_ids, remap, validate_events
from .models import SyncChunk, SyncConflict, SyncLocal, SyncSelection, SyncSession, SyncSource, SyncTrack

CAPABILITIES = {"session_exchange": True, "library_apply": False, "playback": False,
                "audio_transfer": False, "curated_merge": False}


class SyncError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def file_version(filename):
    """Only a selected/bound DB path, never a path from imported JSON."""
    try:
        with Path(filename).open("rb") as stream:
            before = os.fstat(stream.fileno())
            if not 0 < before.st_size <= 512 * 1024 * 1024:
                return None
            hashed, size = hashlib.sha256(), 0
            while block := stream.read(1024 * 1024):
                size += len(block)
                if size > 512 * 1024 * 1024:
                    return None
                hashed.update(block)
            after = os.fstat(stream.fileno())
            current = Path(filename).stat()
            def facts(stat):
                return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns
            if facts(before) != facts(after) or facts(after) != facts(current) or size != before.st_size:
                return None
        return Asset(algorithm="sha256-file-bytes-v1", sha256=hashed.hexdigest(), byte_length=size)
    except OSError:
        return None


def validate_complete(manifest, chunks):
    for seq, events in chunks.items():
        if not 0 <= seq < len(manifest.chunk_sha256) or digest(events) != manifest.chunk_sha256[seq]:
            raise SyncError(409, "stored_chunk_integrity_mismatch")
    if sorted(chunks) != list(range(len(manifest.chunk_sha256))):
        return False
    events = [event for seq in sorted(chunks) for event in chunks[seq]]
    validate_events(events)
    if reference_ids(events) != {ref.source_local_id for ref in manifest.tracks}:
        raise SyncError(422, "complete_reference_manifest_mismatch")
    if not events_contain_audible(events):
        raise SyncError(422, "silent_session_not_exchangeable")
    return True


def stored_snapshot(manifest_json, chunks):
    return {"manifest": json.loads(manifest_json),
            "chunks": [{"seq": seq, "events": chunks[seq]} for seq in sorted(chunks)]}


class PeerSync:
    def __init__(self, db):
        self.db = db

    def _lock(self):
        if self.db.in_transaction():
            raise SyncError(409, "fresh_sync_transaction_required")
        self.db.execute(text("BEGIN IMMEDIATE"))

    def identity(self):
        local = self.db.get(SyncLocal, 1)
        if local is None:
            raise SyncError(409, "initialize_replica_first")
        return {"replica_id": local.replica_id, "authentication": "explicit_local_owner_only"}

    def initialize(self, body=None):
        self._lock()
        if self.db.get(SyncLocal, 1) is None:
            self.db.add(SyncLocal(id=1, replica_id=str(uuid4())))
        self.db.commit()
        return self.identity()

    def accept(self, body):
        self._lock()
        if str(body.replica_id) == self.identity()["replica_id"]:
            raise SyncError(422, "source_is_this_replica")
        source = self.db.get(SyncSource, str(body.replica_id))
        if source is None:
            source = SyncSource(replica_id=str(body.replica_id))
            self.db.add(source)
        source.label = body.label
        self.db.commit()
        return {"replica_id": source.replica_id, "label": source.label,
                "authentication": "namespace_claim_explicitly_accepted_not_cryptographic"}

    def _track(self, local_id):
        track = self.db.get(Track, local_id)
        if track is None:
            raise SyncError(404, "local_track_missing")
        return track

    def _guard(self, track):
        selection = self.db.get(SyncSelection, track.id)
        if selection is None:
            return None
        return digest({"selection": selection.token, "local_id": track.id, "filename": track.filename})

    def track(self, local_id):
        track = self._track(local_id)
        binding = self.db.scalar(select(SyncTrack).where(SyncTrack.track_id == track.id))
        return {"local_id": track.id, "guard": self._guard(track),
                "logical_track_id": binding.logical_track_id if binding else None}

    def select_track(self, local_id, body=None):
        self._lock()
        self.identity()
        self._track(local_id)
        if self.db.get(SyncSelection, local_id) is None:
            self.db.add(SyncSelection(track_id=local_id, token=uuid4().hex))
        self.db.commit()
        return self.track(local_id)

    def bind(self, local_id, body, *, identify=False):
        self._lock()
        self.identity()
        track = self._track(local_id)
        if self._guard(track) is None or body.guard != self._guard(track):
            raise SyncError(409, "stale_local_selection")
        current = self.db.scalar(select(SyncTrack).where(SyncTrack.track_id == local_id))
        logical = current.logical_track_id if identify and current else str(uuid4()) if identify else str(body.logical_track_id)
        binding = self.db.get(SyncTrack, logical)
        if (current and current.logical_track_id != logical) or (binding and binding.track_id not in (None, local_id)):
            raise SyncError(409, "logical_binding_conflict")
        if binding is None:
            binding = SyncTrack(logical_track_id=logical)
            self.db.add(binding)
        binding.track_id = local_id
        self.db.commit()
        return self.track(local_id)

    def identify(self, local_id, body):
        return self.bind(local_id, body, identify=True)

    def _chunks(self, sid):
        return {chunk.seq: json.loads(chunk.events_json) for chunk in self.db.scalars(
            select(SyncChunk).where(SyncChunk.session_uuid == sid).order_by(SyncChunk.seq))}

    def export(self, sid, body):
        self._lock()
        local = self.identity()["replica_id"]
        sid = str(sid)
        stored = self.db.get(SyncSession, sid)
        if stored is not None and stored.direction != "issued":
            raise SyncError(409, "received_session_is_not_local_recording")
        if stored is None:
            recorded = self.db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
            if recorded is None or recorded.ended_at is None:
                raise SyncError(409, "selected_closed_session_required")
            chunks = {chunk.seq: Chunk(seq=chunk.seq, events=json.loads(chunk.events_json)).events for chunk in recorded.chunks}
            if not chunks or sorted(chunks) != list(range(len(chunks))) or len(chunks) > 4096:
                raise SyncError(422, "complete_contiguous_source_chunks_required")
            refs = []
            ids = reference_ids([event for seq in sorted(chunks) for event in chunks[seq]])
            if len(ids) > 128:
                raise SyncError(413, "selected_track_reference_limit")
            for local_id in sorted(ids):
                track = self._track(local_id)
                binding = self.db.scalar(select(SyncTrack).where(SyncTrack.track_id == local_id))
                if binding is None:
                    raise SyncError(409, "explicitly_identify_selected_source_tracks_first")
                refs.append(TrackReference(source_local_id=local_id, logical_track_id=UUID(binding.logical_track_id),
                                           asset=file_version(track.filename) if body.fingerprint_assets else None))
            manifest = Manifest(session_uuid=UUID(sid), origin_replica_id=UUID(local), grammar="capture-events-v1",
                                reference_basis="explicit-current-row-bindings",
                                started_at=recorded.started_at.replace(tzinfo=timezone.utc),
                                ended_at=recorded.ended_at.replace(tzinfo=timezone.utc), tracks=refs,
                                recording_origin=recorded.origin,
                                chunk_sha256=[digest(chunks[seq]) for seq in sorted(chunks)])
            validate_complete(manifest, chunks)
            stored = SyncSession(session_uuid=sid, origin_replica_id=local, direction="issued",
                                 manifest_sha256=digest(manifest.model_dump(mode="json")),
                                 manifest_json=canonical(manifest.model_dump(mode="json")).decode())
            self.db.add(stored)
            self.db.flush()
            for seq, events in chunks.items():
                self.db.add(SyncChunk(session_uuid=sid, seq=seq, events_json=canonical(events).decode()))
        else:
            manifest = Manifest.model_validate_json(stored.manifest_json)
            chunks = self._chunks(sid)
        selected = sorted(chunks) if body.seqs is None else body.seqs
        if not selected or len(set(selected)) != len(selected) or not set(selected) <= chunks.keys():
            raise SyncError(422, "invalid_selected_chunk_sequences")
        bundle = Bundle(format="manadj-peer-session", version=1, digest_algorithm="sha256-rfc8785-jcs-v1", manifest=manifest,
                        chunks=[Chunk(seq=seq, events=chunks[seq]) for seq in selected])
        result = bundle.model_dump(mode="json")
        if len(canonical(result)) > MAX_EXPORT:
            raise SyncError(413, "select_fewer_session_chunks")
        self.db.commit()
        return result

    def _conflict(self, bundle, existing_payload, existing_kind):
        payload = bundle.model_dump(mode="json")
        hashed = digest(payload)
        if self.db.get(SyncConflict, hashed) is None:
            self.db.add(SyncConflict(payload_sha256=hashed, session_uuid=str(bundle.manifest.session_uuid),
                                     existing_sha256=digest(existing_payload), existing_kind=existing_kind,
                                     existing_json=canonical(existing_payload).decode(), incoming_json=canonical(payload).decode()))
        self.db.commit()
        raise SyncError(409, "immutable_session_conflict_preserved")

    def receive(self, bundle):
        self._lock()
        local = self.identity()["replica_id"]
        manifest = bundle.manifest
        origin, sid = str(manifest.origin_replica_id), str(manifest.session_uuid)
        if origin == local or self.db.get(SyncSource, origin) is None:
            raise SyncError(403, "source_namespace_not_explicitly_accepted")
        hashed = digest(manifest.model_dump(mode="json"))
        stored = self.db.get(SyncSession, sid)
        if stored is not None and (stored.direction != "received" or stored.manifest_sha256 != hashed):
            self._conflict(bundle, stored_snapshot(stored.manifest_json, self._chunks(sid)), "peer_snapshot")
        existing_history = self.db.scalar(select(RecordedSession).where(RecordedSession.uuid == sid))
        if existing_history is not None:
            self._conflict(bundle, {
                "uuid": sid, "started_at": existing_history.started_at.isoformat(),
                "ended_at": existing_history.ended_at.isoformat() if existing_history.ended_at else None,
                "origin": existing_history.origin,
                "chunks": [{"seq": chunk.seq, "events": json.loads(chunk.events_json)} for chunk in existing_history.chunks],
            }, "local_history_snapshot")
        if stored is None:
            stored = SyncSession(session_uuid=sid, origin_replica_id=origin, direction="received",
                                 manifest_sha256=hashed, manifest_json=canonical(manifest.model_dump(mode="json")).decode())
            self.db.add(stored)
            self.db.flush()
        chunks = self._chunks(sid)
        duplicate = all(chunk.seq in chunks for chunk in bundle.chunks)
        for chunk in bundle.chunks:
            if chunk.seq in chunks and chunks[chunk.seq] != chunk.events:
                self._conflict(bundle, stored_snapshot(stored.manifest_json, chunks), "peer_snapshot")
            if chunk.seq not in chunks:
                self.db.add(SyncChunk(session_uuid=sid, seq=chunk.seq, events_json=canonical(chunk.events).decode()))
                chunks[chunk.seq] = chunk.events
        complete = validate_complete(manifest, chunks)
        self.db.commit()
        return {"session_uuid": sid, "duplicate": duplicate, "stored_seqs": sorted(chunks),
                "state": "stored_complete" if complete else "partial_chunks", "capabilities": CAPABILITIES}

    def sessions(self):
        self.identity()
        return {"items": [{"session_uuid": item.session_uuid, "origin_replica_id": item.origin_replica_id,
                           "manifest_sha256": item.manifest_sha256} for item in self.db.scalars(
                               select(SyncSession).where(SyncSession.direction == "received").order_by(SyncSession.session_uuid))],
                "capabilities": CAPABILITIES}

    def conflicts(self, sid):
        self.identity()
        records = self.db.scalars(select(SyncConflict).where(SyncConflict.session_uuid == str(sid))
                                 .order_by(SyncConflict.payload_sha256).limit(100)).all()
        items = []
        for record in records:
            incoming = json.loads(record.incoming_json)
            items.append({"payload_sha256": record.payload_sha256,
                          "existing_sha256": record.existing_sha256, "existing_kind": record.existing_kind,
                          "incoming_manifest_sha256": digest(incoming["manifest"]),
                          "origin_replica_id": incoming["manifest"]["origin_replica_id"],
                          "incoming_chunk_seqs": [chunk["seq"] for chunk in incoming["chunks"]]})
        return {"session_uuid": str(sid), "items": items, "resolution": "not_implemented_original_preserved"}

    def detail(self, sid):
        self.identity()
        sid = str(sid)
        stored = self.db.get(SyncSession, sid)
        if stored is None:
            raise SyncError(404, "exchanged_session_missing")
        manifest = Manifest.model_validate_json(stored.manifest_json)
        chunks = self._chunks(sid)
        complete = validate_complete(manifest, chunks)
        dependencies, mapping = [], {}
        for ref in manifest.tracks:
            binding = self.db.get(SyncTrack, str(ref.logical_track_id))
            track = self.db.get(Track, binding.track_id) if binding and binding.track_id is not None else None
            bound = track is not None and track.archived_at is None
            state = "unbound"
            if bound:
                mapping[ref.source_local_id] = track.id
                try:
                    size = Path(track.filename).stat().st_size
                except OSError:
                    state = "missing"
                else:
                    if ref.asset is None:
                        state = "unverified"
                    elif size < ref.asset.byte_length:
                        state = "partial"
                    elif size != ref.asset.byte_length:
                        state = "changed"
                    else:
                        current = file_version(track.filename)
                        state = "exact" if current == ref.asset else "changed"
            dependencies.append({"logical_track_id": str(ref.logical_track_id),
                                 "local_track_id": track.id if bound else None, "asset_state": state})
        resolved = len(mapping) == len(manifest.tracks)
        ready = complete and resolved and all(item["asset_state"] == "exact" for item in dependencies)
        events = [event for seq in sorted(chunks) for event in chunks[seq]]
        session = {"uuid": sid, "started_at": manifest.started_at.isoformat(), "ended_at": manifest.ended_at.isoformat(),
                   "take_count": 0, "origin": manifest.recording_origin or stored.origin_replica_id,
                   "events": remap(events, mapping)} if complete and resolved else None
        return {"session_uuid": sid, "origin_replica_id": stored.origin_replica_id,
                "reference_basis": manifest.reference_basis,
                "recording_origin": manifest.recording_origin,
                "manifest_sha256": stored.manifest_sha256, "stored_seqs": sorted(chunks),
                "state": "partial_chunks" if not complete else "unresolved_references" if not resolved else "resolved" if ready else "assets_unavailable",
                "dependencies_ready": ready, "dependencies": dependencies, "session": session, "capabilities": CAPABILITIES}

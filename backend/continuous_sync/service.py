"""Durable signed operation application into the actual library and Session rows.

No network, automatic enrollment or production startup effects. Transport must
supply operations in per-origin sequence; acknowledge only committed cursors.
"""
import base64
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from sqlalchemy import func, select, text

from backend.device_edits import read_field, write_field
from backend.models import Session as RecordedSession, SessionChunk, Track
from backend.peer_sync.events import remap, validate_events
from backend.peer_sync.models import DeviceGroup, GroupMember, SyncTrack
from .models import CaptureState, Cursor, Head, Operation, SessionOwner

DOMAIN = b'manadj-continuous-sync/v1\x00'
MAX_BYTES = 240 * 1024
MAX_PACKET_BYTES = 248 * 1024
MAX_PAGE_BYTES = 256 * 1024
FIELDS = {'title', 'main_cue'}  # First acceptance slice, not full product scope.


class SyncFailure(ValueError):
    pass


def canonical(value):
    return rfc8785.dumps(value)


def uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise SyncFailure('canonical_uuid_required')
    return value


class Replica:
    def __init__(self, db, group_id):
        self.db, self.group_id = db, uuid(str(group_id))

    def _begin(self):
        if self.db.in_transaction():
            raise SyncFailure('fresh_transaction_required')
        self.db.execute(text('PRAGMA synchronous=FULL'))
        self.db.execute(text('BEGIN IMMEDIATE'))

    def _local(self):
        group = self.db.get(DeviceGroup, self.group_id)
        if group is None:
            raise SyncFailure('local_group_not_provisioned')
        member = self.db.get(GroupMember, (self.group_id, group.device_id))
        if member is None or member.revoked:
            raise SyncFailure('local_member_revoked')
        key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(group.private_seed_b64, validate=True))
        if key.public_key().public_bytes_raw() != base64.b64decode(member.public_key_b64, validate=True):
            raise SyncFailure('local_key_pin_mismatch')
        return group, key

    def _heads(self, entity, field):
        row = self.db.get(Head, (self.group_id, entity, field))
        return json.loads(row.heads_json) if row else []

    def issue(self, entity, field, value):
        """Local user mutation and durable outbox entry commit atomically."""
        self._begin()
        packet = self._issue(entity, field, value)
        self.db.commit()
        return packet

    def _issue(self, entity, field, value, captured=False):
        group, key = self._local()
        seq = (self.db.scalar(select(func.max(Operation.sequence)).where(
            Operation.group_id == self.group_id, Operation.origin_id == group.device_id)) or 0) + 1
        body = {'format': 'manadj-continuous-sync/v1', 'group_id': self.group_id,
                'origin_id': group.device_id, 'generation': 1, 'sequence': seq, 'operation_id': str(uuid4()),
                'entity': entity, 'field': field, 'parents': self._heads(entity, field), 'value': value}
        raw = canonical(body)
        packet = {'body': body, 'signature': base64.b64encode(key.sign(DOMAIN + raw)).decode()}
        self._accept(packet, local=True, captured=captured)
        self.db.flush()
        return packet

    def receive(self, packet):
        self._begin()
        # A normal application write may race the last capture tick. Journal
        # it in this transaction before a remote operation can overwrite it.
        b, _, _ = self._validate(packet)
        if b['entity'].startswith('track:'):
            binding = self.db.get(SyncTrack, b['entity'][6:])
            track = self.db.get(Track, binding.track_id) if binding and binding.track_id else None
            field = b['field']
            baseline = self.db.get(CaptureState, (self.group_id, b['entity'], field))
            if track is not None and baseline is not None and len(self._heads(b['entity'], field)) <= 1:
                value = track.archived_at is not None if field == 'deleted' else read_field(self.db, track, field)[0]
                if canonical(value).decode() != baseline.value_json:
                    self._issue(b['entity'], field, value)
        result = self._accept(packet, local=False)
        self.db.commit()
        return result

    def _validate(self, packet):
        if not isinstance(packet, dict) or set(packet) != {'body', 'signature'} or len(canonical(packet)) > MAX_PACKET_BYTES:
            raise SyncFailure('invalid_packet')
        b = packet['body']
        if not isinstance(b, dict) or set(b) != {'format', 'group_id', 'origin_id', 'sequence',
                'operation_id', 'generation', 'entity', 'field', 'parents', 'value'}:
            raise SyncFailure('invalid_operation')
        if b['format'] != 'manadj-continuous-sync/v1' or b['group_id'] != self.group_id:
            raise SyncFailure('wrong_protocol_or_group')
        uuid(b['origin_id']); uuid(b['operation_id'])
        if type(b['generation']) is not int or b['generation'] != 1:
            raise SyncFailure('unsupported_device_generation')
        if type(b['sequence']) is not int or not 1 <= b['sequence'] <= 9007199254740991:
            raise SyncFailure('invalid_sequence')
        if not isinstance(b['parents'], list) or len(b['parents']) > 32 or len(set(b['parents'])) != len(b['parents']):
            raise SyncFailure('invalid_parents')
        for parent in b['parents']:
            uuid(parent)
        if not isinstance(b['entity'], str) or not isinstance(b['field'], str):
            raise SyncFailure('invalid_entity')
        kind, sep, identity = b['entity'].partition(':')
        if not sep or kind not in {'track', 'session'}:
            raise SyncFailure('unsupported_entity')
        uuid(identity)
        if kind == 'track' and b['field'] not in FIELDS | {'deleted'}:
            raise SyncFailure('unsupported_field')
        if kind == 'session' and b['field'] not in {'start', 'end'} and not (b['field'].startswith('chunk:') and b['field'][6:].isdigit() and str(int(b['field'][6:])) == b['field'][6:] and int(b['field'][6:]) < 1000000):
            raise SyncFailure('unsupported_session_field')
        raw = canonical(b)
        if len(raw) > MAX_BYTES:
            raise SyncFailure('operation_too_large')
        member = self.db.get(GroupMember, (self.group_id, b['origin_id']))
        if member is None or member.revoked:
            raise SyncFailure('untrusted_origin')
        try:
            Ed25519PublicKey.from_public_bytes(base64.b64decode(member.public_key_b64, validate=True)).verify(
                base64.b64decode(packet['signature'], validate=True), DOMAIN + raw)
        except Exception as error:
            raise SyncFailure('invalid_signature') from error
        return b, raw, hashlib.sha256(raw).hexdigest()

    def _accept(self, packet, local, captured=False):
        b, raw, hashed = self._validate(packet)
        old = self.db.scalar(select(Operation).where(Operation.group_id == self.group_id,
            Operation.operation_id == b['operation_id']))
        if old:
            if old.sha256 != hashed:
                raise SyncFailure('operation_equivocation')
            return {'duplicate': True, 'state': old.state, 'sequence': old.sequence}
        group, _ = self._local()
        if not local and b['origin_id'] == group.device_id:
            raise SyncFailure('unknown_local_operation')
        cursor = self.db.get(Cursor, (self.group_id, b['origin_id']))
        expected = (cursor.sequence if cursor else 0) + 1
        if b['sequence'] != expected:
            raise SyncFailure('origin_gap_or_equivocation')
        for parent in b['parents']:
            p = self.db.scalar(select(Operation).where(Operation.group_id == self.group_id, Operation.operation_id == parent))
            if not p or (p.body and (json.loads(p.body)['entity'], json.loads(p.body)['field']) != (b['entity'], b['field'])):
                raise SyncFailure('missing_or_wrong_field_parent')
        if b['entity'].startswith('session:') and b['field'] != 'start':
            owner = self.db.get(SessionOwner, (self.group_id, b['entity'][8:]))
            if owner is None or owner.origin_id != b['origin_id']:
                raise SyncFailure('session_origin_mismatch')
        heads = self._heads(b['entity'], b['field'])
        remaining = sorted(set(heads) - set(b['parents']))
        state = 'conflict' if remaining else self._project(b, captured=captured)
        row = Operation(group_id=self.group_id, origin_id=b['origin_id'], sequence=b['sequence'],
            operation_id=b['operation_id'], sha256=hashed, body=raw.decode(), signature=packet['signature'], state=state)
        self.db.add(row)
        head = self.db.get(Head, (self.group_id, b['entity'], b['field']))
        if head is None:
            head = Head(group_id=self.group_id, entity=b['entity'], field=b['field'])
            self.db.add(head)
        head.heads_json = json.dumps(sorted(remaining + [b['operation_id']]))
        if cursor is None:
            cursor = Cursor(group_id=self.group_id, origin_id=b['origin_id'])
            self.db.add(cursor)
        cursor.sequence = b['sequence']
        if state == 'applied':
            self._capture_value(b['entity'], b['field'], b['value'])
        return {'duplicate': False, 'state': state, 'sequence': b['sequence']}

    def _project(self, b, captured=False):
        kind, identity = b['entity'].split(':', 1)
        if kind == 'track':
            binding = self.db.get(SyncTrack, identity)
            track = self.db.get(Track, binding.track_id) if binding and binding.track_id else None
            if track is None:
                raise SyncFailure('unresolved_logical_track')
            if b['field'] == 'deleted':
                if b['value'] is not True:
                    raise SyncFailure('restore_not_supported_in_slice')
                track.archived_at = datetime.now(timezone.utc).replace(tzinfo=None)
            elif track.archived_at is not None:
                return 'blocked_by_tombstone'
            else:
                write_field(self.db, track, b['field'], b['value'])
            return 'applied'
        owner = self.db.get(SessionOwner, (self.group_id, identity))
        session = self.db.scalar(select(RecordedSession).where(RecordedSession.uuid == identity))
        if b['field'] == 'start':
            from backend.peer_sync.group_history import owns_uuid
            if owns_uuid(self.db, identity) or (session is not None and session.peer_history is not None):
                raise SyncFailure('foreign_session_identity')
            if owner or (session and not (captured and session.origin is None)) or b['parents']:
                raise SyncFailure('session_identity_collision')
            start = self._date(b['value'])
            self.db.add(SessionOwner(group_id=self.group_id, session_uuid=identity, origin_id=b['origin_id']))
            if session is None:
                self.db.add(RecordedSession(uuid=identity, started_at=start, origin='own-device:' + b['origin_id']))
            elif session.started_at != start:
                raise SyncFailure('source_session_start_changed')
            return 'applied'
        if not owner or owner.origin_id != b['origin_id'] or not session:
            raise SyncFailure('session_origin_mismatch')
        if b['field'] == 'end':
            end = self._date(b['value'])
            if end < session.started_at:
                raise SyncFailure('invalid_session_end')
            if session.ended_at is not None and session.ended_at != end:
                raise SyncFailure('immutable_session_end')
            session.ended_at = end
            return 'applied'
        seq = int(b['field'][6:])
        if session.ended_at is not None and not captured:
            raise SyncFailure('session_already_ended')
        value = b['value']
        if not isinstance(value, dict) or set(value) != {'events', 'tracks'} or not isinstance(value['events'], list) or len(value['events']) > 1024 or not isinstance(value['tracks'], dict):
            raise SyncFailure('invalid_chunk')
        validate_events(value['events'])
        mapping = {}
        for source, logical in value['tracks'].items():
            if not source.isdigit():
                raise SyncFailure('invalid_track_reference')
            binding = self.db.get(SyncTrack, uuid(logical))
            if not binding or binding.track_id is None:
                raise SyncFailure('unresolved_session_track')
            mapping[int(source)] = binding.track_id
        events = remap(value['events'], mapping)
        if captured:
            existing = self.db.scalar(select(SessionChunk).where(SessionChunk.session_id == session.id, SessionChunk.seq == seq))
            if existing is None or canonical(json.loads(existing.events_json)) != canonical(events):
                raise SyncFailure('captured_chunk_changed')
            return 'applied'
        existing = self.db.scalar(select(SessionChunk).where(SessionChunk.session_id == session.id, SessionChunk.seq == seq))
        if existing:
            raise SyncFailure('session_chunk_rewrite')
        previous = self.db.scalar(select(SessionChunk).where(SessionChunk.session_id == session.id,
            SessionChunk.seq < seq).order_by(SessionChunk.seq.desc()).limit(1))
        following = self.db.scalar(select(SessionChunk).where(SessionChunk.session_id == session.id,
            SessionChunk.seq > seq).order_by(SessionChunk.seq).limit(1))
        if previous and events and json.loads(previous.events_json) and events[0]['t'] < json.loads(previous.events_json)[-1]['t']:
            raise SyncFailure('session_time_reversal')
        if following and events and json.loads(following.events_json) and events[-1]['t'] > json.loads(following.events_json)[0]['t']:
            raise SyncFailure('session_time_reversal')
        self.db.add(SessionChunk(session_id=session.id, seq=seq, events_json=json.dumps(events)))
        return 'applied'

    @staticmethod
    def _date(value):
        if not isinstance(value, str):
            raise SyncFailure('iso_timestamp_required')
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            raise SyncFailure('timezone_required')
        return date.astimezone(timezone.utc).replace(tzinfo=None)

    def packets(self, origin, after=0, limit=32):
        uuid(origin)
        if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 32:
            raise SyncFailure('invalid_page')
        rows = self.db.scalars(select(Operation).where(Operation.group_id == self.group_id,
            Operation.origin_id == origin, Operation.sequence > after).order_by(Operation.sequence).limit(limit))
        return [{'body': json.loads(r.body), 'signature': r.signature} for r in rows]

    def _capture_value(self, entity, field, value):
        state = self.db.get(CaptureState, (self.group_id, entity, field))
        if state is None:
            state = CaptureState(group_id=self.group_id, entity=entity, field=field)
            self.db.add(state)
        state.value_json = canonical(value).decode()

    def enroll_track(self, logical):
        """Explicit own-library bootstrap captures a baseline, no network effects."""
        self._begin()
        self._local()
        binding = self.db.get(SyncTrack, uuid(logical))
        track = self.db.get(Track, binding.track_id) if binding and binding.track_id else None
        if track is None:
            raise SyncFailure('unresolved_logical_track')
        for field in sorted(FIELDS):
            if self.db.get(CaptureState, (self.group_id, 'track:' + logical, field)) is None:
                self._capture_value('track:' + logical, field, read_field(self.db, track, field)[0])
        if self.db.get(CaptureState, (self.group_id, 'track:' + logical, 'deleted')) is None:
            self._capture_value('track:' + logical, 'deleted', track.archived_at is not None)
        self.db.commit()

    def capture(self, limit=32):
        """Bounded application-owned tick, actual committed mutations to durable outbox.

        Received projections update baselines, so they are not reissued as local
        edits. Enrollment is explicit; no arbitrary library scan or file upload.
        """
        if type(limit) is not int or not 1 <= limit <= 32:
            raise SyncFailure('invalid_capture_limit')
        self._begin()
        group, _ = self._local()
        issued = []
        for binding in self.db.scalars(select(SyncTrack).order_by(SyncTrack.logical_track_id)):
            entity = 'track:' + binding.logical_track_id
            track = self.db.get(Track, binding.track_id) if binding.track_id else None
            if track is None:
                continue
            for field in ['deleted'] + sorted(FIELDS):
                state = self.db.get(CaptureState, (self.group_id, entity, field))
                if state is None:
                    continue
                value = track.archived_at is not None if field == 'deleted' else read_field(self.db, track, field)[0]
                if field != 'deleted' and track.archived_at is not None:
                    continue
                # Never turn an unresolved remote conflict into an automatic
                # local choice merely because the displayed value differs.
                if len(self._heads(entity, field)) > 1:
                    continue
                if canonical(value).decode() != state.value_json:
                    issued.append(self._issue(entity, field, value))
                    if len(issued) >= limit:
                        self.db.commit(); return issued
        for session in self.db.scalars(select(RecordedSession).where(RecordedSession.origin.is_(None)).order_by(RecordedSession.id)):
            # Existing foreign/peer/group-derived history is not local capture.
            from backend.peer_sync.group_history import owns_uuid
            from .provenance import received
            if session.peer_history is not None or owns_uuid(self.db, session.uuid) or received(self.db, session.uuid):
                continue
            entity = 'session:' + uuid(session.uuid)
            owner = self.db.get(SessionOwner, (self.group_id, session.uuid))
            if owner is None:
                issued.append(self._issue(entity, 'start', self._iso(session.started_at), captured=True))
                if len(issued) >= limit:
                    self.db.commit(); return issued
            elif owner.origin_id != group.device_id:
                continue
            for chunk in self.db.scalars(select(SessionChunk).where(SessionChunk.session_id == session.id).order_by(SessionChunk.seq)):
                field = 'chunk:' + str(chunk.seq)
                if self._heads(entity, field):
                    continue
                events = json.loads(chunk.events_json)
                from backend.peer_sync.events import reference_ids
                refs = reference_ids(events)
                mapping = {}
                for local_id in refs:
                    binding = self.db.scalar(select(SyncTrack).where(SyncTrack.track_id == local_id))
                    if binding is None:
                        raise SyncFailure('capture_track_unbound')
                    mapping[str(local_id)] = binding.logical_track_id
                issued.append(self._issue(entity, field, {'events': events, 'tracks': mapping}, captured=True))
                if len(issued) >= limit:
                    self.db.commit(); return issued
            if session.ended_at is not None and not self._heads(entity, 'end'):
                issued.append(self._issue(entity, 'end', self._iso(session.ended_at), captured=True))
                if len(issued) >= limit:
                    self.db.commit(); return issued
        self.db.commit()
        return issued

    @staticmethod
    def _iso(value):
        return value.replace(tzinfo=timezone.utc).isoformat()

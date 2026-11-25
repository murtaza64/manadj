"""Application-owned bounded delivery. No startup/network/config effects on import."""
from .models import Cursor, RelayCheckpoint
from .service import Replica, SyncFailure


class Pump:
    def __init__(self, sessions, group_id, transport, origins):
        self.sessions, self.group_id = sessions, group_id
        self.transport = transport
        # Pinned enrollment, not a device list discovered from remote content.
        self.origins = tuple(origins)

    def tick(self, limit=8):
        if type(limit) is not int or not 1 <= limit <= 32:
            raise SyncFailure('invalid_cycle_limit')
        with self.sessions() as db:
            replica = Replica(db, self.group_id)
            replica.capture(limit=limit)
        with self.sessions() as db:
            replica = Replica(db, self.group_id)
            group, _ = replica._local()
            local = group.device_id
            head = self.transport.head(local)
            from sqlalchemy import select, func
            from .models import Operation
            latest = db.scalar(select(func.max(Operation.sequence)).where(Operation.group_id == self.group_id, Operation.origin_id == local)) or 0
            if type(head) is not int or not 0 <= head <= latest:
                raise SyncFailure('remote_head_exceeds_local_log')
            checkpoint = db.get(RelayCheckpoint, (self.group_id, local))
            verified = checkpoint.sequence if checkpoint else 0
            if head < verified:
                raise SyncFailure('remote_head_rollback')
            # Recheck the boundary on every cycle. New prefixes are verified in
            # bounded pages and publication waits until the whole head matches.
            if verified:
                boundary = self.transport.read(local, after=verified - 1, limit=1)
                if boundary != replica.packets(local, after=verified - 1, limit=1):
                    raise SyncFailure('remote_local_history_fork')
            after = verified
            if head > verified:
                remote = self.transport.read(local, after=after, limit=limit)
                own = replica.packets(local, after=after, limit=len(remote) or 1)
                if not remote or remote != own[:len(remote)] or remote[-1]['body']['sequence'] > head:
                    raise SyncFailure('remote_local_history_fork')
                verified = remote[-1]['body']['sequence']
                if checkpoint is None:
                    checkpoint = RelayCheckpoint(group_id=self.group_id, origin_id=local)
                    db.add(checkpoint)
                checkpoint.sequence = verified
                db.commit()
            packets = replica.packets(local, after=head, limit=limit) if verified == head else []
        published = 0
        for packet in packets:
            # Publish is idempotent and compares expected per-origin sequence.
            # A timeout after a write is reconciled on the next tick by head().
            self.transport.publish(packet, expected=packet['body']['sequence'] - 1)
            published += 1
        applied = 0
        for origin in self.origins:
            if origin == local:
                continue
            with self.sessions() as db:
                cursor = db.get(Cursor, (self.group_id, origin))
                after = cursor.sequence if cursor else 0
            for packet in self.transport.read(origin, after=after, limit=limit):
                if packet.get('body', {}).get('origin_id') != origin:
                    raise SyncFailure('transport_origin_mismatch')
                try:
                    with self.sessions() as db:
                        Replica(db, self.group_id).receive(packet)
                except SyncFailure as error:
                    if str(error) == 'missing_or_wrong_field_parent':
                        # Relay retains the packet and cursor stays put. Other
                        # origins may supply its dependency this cycle.
                        break
                    raise
                applied += 1
        return {'published': published, 'applied': applied}

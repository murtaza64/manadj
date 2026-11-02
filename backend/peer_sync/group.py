"""Transport-independent durable own-device ledger. No network enrollment authority.

Write entrypoints require a fresh SQLAlchemy Session. Network adapters roll back
on failure. Local provisioning must be invoked only by the local owner, never by
an authenticated group member on behalf of that owner.
"""
from uuid import UUID, uuid4

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from sqlalchemy import exists, select, text

from .contracts import Bundle, Chunk, Manifest
from .group_contracts import (
    DOMAIN,
    Ack,
    Delivery,
    Operation,
    Pull,
    Signed,
    decode,
    encode,
    sign,
    unpack,
)
from .models import DeviceGroup, GroupAck, GroupMember, GroupOperation, GroupPossession, SyncSession
from .service import PeerSync, SyncError, validate_complete

MAX_OPERATION_BYTES = 1024 * 1024


class GroupSync:
    def __init__(self, db, group_id):
        self.db = db
        self.group_id = str(UUID(str(group_id)))

    def _lock(self):
        if self.db.in_transaction():
            raise SyncError(409, "fresh_sync_transaction_required")
        # Group receipts promise committed metadata, not merely a WAL write
        # surviving this process. Upgrade NORMAL to FULL before BEGIN: SQLite
        # syncs the WAL on commit before we return an ack. A pooled connection
        # may retain the stronger setting; never weaken it during cleanup.
        self.db.execute(text("PRAGMA synchronous=FULL"))
        self.db.execute(text("BEGIN IMMEDIATE"))

    def _local(self):
        group = self.db.get(DeviceGroup, self.group_id)
        if group is None:
            raise SyncError(403, "unknown_device_group")
        self._member(group.device_id)
        return group

    def _member(self, device_id):
        member = self.db.get(GroupMember, (self.group_id, str(device_id)))
        if member is None or member.revoked:
            raise SyncError(403, "unknown_or_revoked_group_member")
        return member

    def provision(self, private_seed):
        """Local-owner-only creation. No wire endpoint; never reset an existing group."""
        key = Ed25519PrivateKey.from_private_bytes(private_seed)
        self._lock()
        device = PeerSync(self.db).identity()["replica_id"]
        if self.db.get(DeviceGroup, self.group_id) is not None:
            raise SyncError(409, "group_already_provisioned")
        self.db.add(DeviceGroup(group_id=self.group_id, device_id=device, private_seed_b64=encode(private_seed)))
        self.db.flush()
        self.db.add(GroupMember(group_id=self.group_id, device_id=device,
                                public_key_b64=encode(key.public_key().public_bytes_raw()), revoked=0))
        self.db.commit()
        return {"device_id": device, "public_key_b64": encode(key.public_key().public_bytes_raw())}

    def pin_member(self, device_id, public_key_b64):
        """Explicit local trust establishment; no key replacement or un-revocation."""
        device_id = str(UUID(str(device_id)))
        raw = decode(public_key_b64)
        Ed25519PublicKey.from_public_bytes(raw)
        self._lock()
        self._local()
        old = self.db.get(GroupMember, (self.group_id, device_id))
        if old is not None and (old.revoked or old.public_key_b64 != public_key_b64):
            raise SyncError(409, "member_pin_is_immutable")
        if old is None:
            self.db.add(GroupMember(group_id=self.group_id, device_id=device_id,
                                    public_key_b64=public_key_b64, revoked=0))
        self.db.commit()

    def revoke(self, device_id):
        self._lock()
        self._local()
        self._member(str(device_id)).revoked = 1
        self.db.commit()

    def _sign(self, kind, **fields):
        local = self._local()
        return sign({"format": "manadj-device-group/v1", "group_id": self.group_id,
                     "origin_device_id": local.device_id, "kind": kind, **fields}, decode(local.private_seed_b64))

    def _verify(self, signed, model, *, addressed=False):
        body, raw, hashed = unpack(signed, model)
        if str(body.group_id) != self.group_id:
            raise SyncError(403, "wrong_device_group")
        member = self._member(body.origin_device_id)
        try:
            Ed25519PublicKey.from_public_bytes(decode(member.public_key_b64)).verify(
                decode(signed.signature_b64), DOMAIN + raw)
        except InvalidSignature:
            raise SyncError(403, "invalid_group_signature") from None
        if addressed and str(body.recipient_device_id) != self._local().device_id:
            raise SyncError(403, "wrong_group_recipient")
        return body, raw, hashed

    def _operation(self, operation_id):
        return self.db.scalar(select(GroupOperation).where(
            GroupOperation.group_id == self.group_id, GroupOperation.operation_id == str(operation_id)))

    @staticmethod
    def _signed(row):
        return Signed(body_b64=row.body_b64, signature_b64=row.signature_b64)

    def _store(self, signed):
        operation, raw, hashed = self._verify(signed, Operation)
        if len(raw) > MAX_OPERATION_BYTES:
            raise SyncError(413, "group_operation_too_large")
        manifest = operation.bundle.manifest
        if manifest.origin_replica_id != operation.origin_device_id:
            raise SyncError(403, "operation_origin_mismatch")
        if not validate_complete(manifest, {c.seq: c.events for c in operation.bundle.chunks}):
            raise SyncError(422, "complete_group_session_required")
        old = self._operation(operation.operation_id)
        if old is not None:
            if old.sha256 != hashed:
                raise SyncError(409, "operation_id_equivocation")
            return old
        # Local-origin evidence must already exist locally; a relay cannot invent
        # a local operation, even when it possesses an old valid signature.
        if str(operation.origin_device_id) == self._local().device_id:
            raise SyncError(409, "unknown_local_origin_operation")
        row = GroupOperation(group_id=self.group_id, operation_id=str(operation.operation_id),
            origin_device_id=str(operation.origin_device_id), session_uuid=str(manifest.session_uuid),
            sha256=hashed, body_b64=signed.body_b64, signature_b64=signed.signature_b64)
        self.db.add(row)
        self.db.flush()
        return row

    def issue(self, session_uuid):
        """Sign only a complete immutable locally-issued existing Session export."""
        self._lock()
        local = self._local()
        old = self.db.scalar(select(GroupOperation).where(GroupOperation.group_id == self.group_id,
            GroupOperation.origin_device_id == local.device_id, GroupOperation.session_uuid == str(session_uuid)))
        if old is not None:
            result = self._signed(old)
            self.db.commit()
            return result
        peer = PeerSync(self.db)
        source = self.db.get(SyncSession, str(session_uuid))
        if source is None or source.direction != "issued" or source.origin_replica_id != local.device_id:
            raise SyncError(409, "export_local_session_first")
        bundle = Bundle(format="manadj-peer-session", version=1, digest_algorithm="sha256-rfc8785-jcs-v1",
            manifest=Manifest.model_validate_json(source.manifest_json),
            chunks=[Chunk(seq=seq, events=events) for seq, events in peer._chunks(str(session_uuid)).items()])
        if not validate_complete(bundle.manifest, {c.seq: c.events for c in bundle.chunks}):
            raise SyncError(422, "complete_group_session_required")
        operation_id = str(uuid4())
        signed = self._sign("session-create", operation_id=operation_id, parents=[], bundle=bundle.model_dump(mode="json"))
        _, raw, hashed = unpack(signed, Operation)
        if len(raw) > MAX_OPERATION_BYTES:
            raise SyncError(413, "group_operation_too_large")
        self.db.add(GroupOperation(group_id=self.group_id, operation_id=operation_id,
            origin_device_id=local.device_id, session_uuid=str(session_uuid), sha256=hashed,
            body_b64=signed.body_b64, signature_b64=signed.signature_b64))
        self.db.commit()
        return signed

    def delivery(self, recipient, operation_id):
        self._member(recipient)
        row = self._operation(operation_id)
        if row is None:
            raise SyncError(404, "group_operation_missing")
        self._member(row.origin_device_id)
        return self._sign("deliver", recipient_device_id=str(recipient), operation=self._signed(row).model_dump())

    def _receipt(self, row, recipient):
        return self._sign("ack", recipient_device_id=str(recipient), operation_id=row.operation_id,
                          operation_sha256=row.sha256)

    def _supplied(self, row, device_id, proof):
        """Caller already verified this addressed Delivery/Page and inner op.

        The peer signed these exact bytes as supplied; do not invent its ack.
        Persist the signed outer evidence separately from original operation.
        """
        key = (self.group_id, row.operation_id, str(device_id))
        if self.db.get(GroupPossession, key) is None:
            self.db.add(GroupPossession(group_id=key[0], operation_id=key[1], device_id=key[2],
                sha256=row.sha256, proof_body_b64=proof.body_b64, proof_signature_b64=proof.signature_b64))

    def receive(self, signed):
        self._lock()
        delivery, _, _ = self._verify(signed, Delivery, addressed=True)
        row = self._store(delivery.operation)
        self._supplied(row, delivery.origin_device_id, signed)
        ack = self._receipt(row, delivery.origin_device_id)
        self.db.commit()
        return ack

    def accept_ack(self, signed):
        self._lock()
        ack, _, _ = self._verify(signed, Ack, addressed=True)
        row = self._operation(ack.operation_id)
        if row is None or row.sha256 != ack.operation_sha256:
            raise SyncError(409, "ack_operation_mismatch")
        self._member(row.origin_device_id)
        key = (self.group_id, row.operation_id, str(ack.origin_device_id))
        if self.db.get(GroupAck, key) is None:
            self.db.add(GroupAck(group_id=key[0], operation_id=key[1], device_id=key[2], sha256=row.sha256))
        self.db.commit()
        return {"stored": True}

    def pull_request(self, recipient, after=0, request_id=None):
        self._member(recipient)
        body = self._sign("pull", recipient_device_id=str(recipient), request_id=str(request_id or uuid4()), after=after)
        unpack(body, Pull)
        return body

    def pull(self, signed):
        request, _, _ = self._verify(signed, Pull, addressed=True)
        requester = str(request.origin_device_id)
        acknowledged = exists().where(GroupAck.group_id == self.group_id,
            GroupAck.operation_id == GroupOperation.operation_id, GroupAck.device_id == requester)
        supplied = exists().where(GroupPossession.group_id == self.group_id,
            GroupPossession.operation_id == GroupOperation.operation_id, GroupPossession.device_id == requester)
        rows = self.db.scalars(select(GroupOperation).join(GroupMember,
            (GroupMember.group_id == GroupOperation.group_id) & (GroupMember.device_id == GroupOperation.origin_device_id))
            .where(GroupOperation.group_id == self.group_id, GroupOperation.cursor > request.after,
                   GroupOperation.origin_device_id != requester, GroupMember.revoked == 0, ~acknowledged, ~supplied)
            .order_by(GroupOperation.cursor).limit(2)).all()
        return self._sign("page", recipient_device_id=requester, request_id=str(request.request_id),
            next_after=rows[0].cursor if rows else request.after, more=len(rows) > 1,
            operations=[self._signed(rows[0]).model_dump()] if rows else [])

    def receive_page(self, signed, request_signed):
        """Foreground client's receiving seam. Ack is addressed to serving peer."""
        from .group_contracts import Page
        self._lock()
        request, _, _ = self._verify(request_signed, Pull)
        page, _, _ = self._verify(signed, Page, addressed=True)
        if (request.origin_device_id != UUID(self._local().device_id)
                or page.origin_device_id != request.recipient_device_id or page.request_id != request.request_id
                or page.next_after < request.after):
            raise SyncError(403, "group_page_request_mismatch")
        receipts = []
        for operation in page.operations:
            row = self._store(operation)
            self._supplied(row, page.origin_device_id, signed)
            receipts.append(self._receipt(row, page.origin_device_id))
        self.db.commit()
        return {"acks": receipts, "next_after": page.next_after, "more": page.more}

    def project(self, operation_id):
        """Explicit group-authenticated evidence projection; never legacy source trust."""
        self._lock()
        self._local()
        row = self._operation(operation_id)
        if row is None:
            raise SyncError(404, "group_operation_missing")
        operation, _, _ = self._verify(self._signed(row), Operation)
        if str(operation.origin_device_id) == self._local().device_id:
            raise SyncError(409, "local_evidence_already_projected")
        return PeerSync(self.db)._store_verified_bundle(operation.bundle)

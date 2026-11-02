"""Local, non-playable normal-history projection of durable signed group evidence.

Ledger ownership fences UUIDs independently of successful derived writes. Reads
never repair or import; a failed projector leaves a visible retryable pending
view, not permission to reinterpret foreign integers through a recorded source.
"""
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from ..models import Session as RecordedSession
from ..models import Track
from .contracts import digest
from .group import GroupSync
from .group_contracts import Delivery, Operation, Page, Signed, unpack
from .models import (
    DeviceGroup,
    GroupHistory,
    GroupMember,
    GroupOperation,
    GroupPossession,
    SyncSession,
)
from .projection_contracts import GroupSessionView
from .service import PeerSync, SyncError, validate_complete

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GroupClaim:
    """Denial identity recovered before consulting fallible ledger indexes.

    `row` stays untouched so full validation still detects contradictory DB
    columns. Body identities can preserve denial, never grant replay authority.
    """
    row: GroupOperation
    session_uuid: str
    group_id: str
    operation_id: str
    origin_device_id: str
    missing: bool = False

    def __getattr__(self, name):
        return getattr(self.row, name)


def canonical_uuid(value):
    try:
        return str(UUID(str(value)))
    except ValueError:
        return str(value)


def received_operations(db, uuid=None):
    result = []
    represented = set()
    own_verified = set()
    # Never filter on unauthenticated origin/session bookkeeping first. A
    # single damaged column must not resurrect a retained raw-ID recording.
    for row in db.scalars(select(GroupOperation).order_by(GroupOperation.group_id, GroupOperation.operation_id)):
        operation = None
        try:
            operation = unpack(GroupSync._signed(row), Operation)[0]
            verified = verified_operation(db, row)
            group = db.get(DeviceGroup, row.group_id)
            if group is not None and str(verified.origin_device_id) == group.device_id:
                own_verified.add((str(verified.group_id), str(verified.operation_id),
                    str(verified.bundle.manifest.session_uuid), str(verified.origin_device_id), row.sha256))
                continue  # exact verified own-issued evidence only
        except (SyncError, ValueError, TypeError, KeyError, RecursionError):
            pass
        identities = set()
        try:
            identities.add(str(UUID(row.session_uuid)))
        except (ValueError, TypeError):
            pass
        if operation:
            identities.add(str(operation.bundle.manifest.session_uuid))
        if not identities:
            raise HTTPException(409, "group_uuid_authority_unavailable")
        for sid in sorted(identities):
            if uuid is None or sid == canonical_uuid(uuid):
                result.append(GroupClaim(row=row, session_uuid=sid,
                    group_id=str(operation.group_id) if operation else row.group_id,
                    operation_id=str(operation.operation_id) if operation else row.operation_id,
                    origin_device_id=str(operation.origin_device_id) if operation else row.origin_device_id))
                represented.add((result[-1].group_id, result[-1].operation_id, sid,
                                 result[-1].origin_device_id, row.sha256))
    # Supplying-peer proof commits atomically with each received operation and
    # retains the original signed bytes. It is a second denial anchor when a
    # ledger row is missing, including a collision that never materialized.
    for receipt in db.scalars(select(GroupPossession)):
        proof = Signed(body_b64=receipt.proof_body_b64, signature_b64=receipt.proof_signature_b64)
        try:
            try:
                signed_operations = [unpack(proof, Delivery)[0].operation]
            except ValueError:
                signed_operations = unpack(proof, Page)[0].operations
            if len(signed_operations) != 1:
                raise ValueError("Supplying proof lost its operation identity")
            for signed in signed_operations:
                operation, _, hashed = unpack(signed, Operation)
                key = (str(operation.group_id), str(operation.operation_id), str(operation.bundle.manifest.session_uuid))
                identity = (*key, str(operation.origin_device_id), hashed)
                # Receipt indexes are fallible bookkeeping too. A readable
                # original proof keeps its own denial identity even when an
                # index aliases another valid (including own-issued) row.
                if identity in represented or identity in own_verified:
                    continue
                if uuid is not None and key[2] != canonical_uuid(uuid):
                    continue
                ghost = GroupOperation(group_id=key[0], operation_id=key[1], session_uuid=key[2],
                    origin_device_id=str(operation.origin_device_id), sha256=hashed,
                    body_b64=signed.body_b64, signature_b64=signed.signature_b64)
                result.append(GroupClaim(row=ghost, session_uuid=key[2], group_id=key[0], operation_id=key[1],
                    origin_device_id=str(operation.origin_device_id), missing=True))
                represented.add(identity)
        except (ValueError, TypeError, KeyError, RecursionError):
            # Unreadable proof cannot be covered merely by an indexed row:
            # that index could itself be corrupt. Unknown is never empty.
            raise HTTPException(409, "group_uuid_authority_unavailable") from None
    return result


def owns_uuid(db, uuid):
    if received_operations(db, uuid):
        return True
    return db.scalar(select(GroupHistory.session_id).join(RecordedSession).where(
        RecordedSession.uuid == canonical_uuid(uuid))) is not None


def deny_group_uuid(db, uuid):
    if owns_uuid(db, uuid):
        raise HTTPException(409, "group_session_is_metadata_only")


def paired_deny_items(db):
    """Deny-only markers in the existing v1 paired-peer UUID authority stream.

    Even pre-group #443 clients persist every item UUID, including unsupported
    states. Never advertise READY/materialization/audio or grant membership.
    This prevents a refreshed non-enrolled phone resurrecting an old raw cache.
    """
    claims = {}
    for row in received_operations(db):
        claims.setdefault(row.session_uuid, set()).add((row.group_id, row.operation_id, row.origin_device_id, row.sha256))
    for normal in db.scalars(select(RecordedSession).join(GroupHistory)):
        history = normal.group_history
        claims.setdefault(normal.uuid, set()).add((history.group_id, history.operation_id,
                                                   history.origin_device_id, history.source_sha256))
    result = []
    for uuid, evidence in sorted(claims.items()):
        ordered = sorted(evidence)
        reasons = [{"group_id": gid, "operation_id": oid, "origin_device_id": origin,
                    "operation_sha256": sha} for gid, oid, origin, sha in ordered] if len(ordered) <= 256 else []
        source = db.get(SyncSession, uuid)
        result.append({"session_uuid": uuid, "origin_replica_id": ordered[0][2],
            "recording_origin": "Group Session evidence", "manifest_sha256": source.manifest_sha256 if source else "0" * 64,
            "started_at": None, "ended_at": None, "materialized": False,
            "state": "group_metadata_only", "group_managed": True, "group_claims": reasons, "replay_generation": None,
            "dependencies": [], "conflict_count": 0})
    return result


def verified_operation(db, row):
    if isinstance(row, GroupClaim):
        if row.missing:
            raise SyncError(409, "group_projection_ledger_missing")
        row = row.row
    group = GroupSync(db, row.group_id)
    group._local()
    operation, _, hashed = group._verify(group._signed(row), Operation)
    manifest = operation.bundle.manifest
    if (hashed != row.sha256 or str(operation.operation_id) != row.operation_id
            or str(manifest.session_uuid) != row.session_uuid
            or str(operation.origin_device_id) != row.origin_device_id
            or manifest.origin_replica_id != operation.origin_device_id
            or not validate_complete(manifest, {c.seq: c.events for c in operation.bundle.chunks})):
        raise SyncError(409, "group_projection_source_integrity_mismatch")
    return operation


def device(db, gid, device_id):
    member = db.get(GroupMember, (gid, device_id))
    return {"device_id": device_id, "label": member.label if member else "Unknown device",
            "revoked": member is None or bool(member.revoked)}


def views(db, uuid=None):
    rows = received_operations(db, uuid)
    result = []
    for row in rows:
        normal = db.scalar(select(RecordedSession).where(RecordedSession.uuid == row.session_uuid))
        history = normal.group_history if normal is not None else None
        status = None
        operation = None
        try:
            operation = verified_operation(db, row)
        except SyncError as error:
            status = "revoked" if error.code in ("unknown_or_revoked_group_member", "unknown_device_group") else "invalid"
        except (ValueError, TypeError, KeyError, RecursionError):
            status = "invalid"
        # Invalid evidence may still have a structurally valid header for
        # inspection. These bytes are never used to authorize a projection.
        if operation is None:
            try:
                operation = unpack(GroupSync._signed(row), Operation)[0]
            except (ValueError, TypeError, KeyError, RecursionError):
                operation = None
        manifest = operation.bundle.manifest if operation else None
        hashed = digest(manifest.model_dump(mode="json")) if manifest else "0" * 64
        projected = bool(history and history.manifest_sha256 == hashed)
        if history and history.group_id == row.group_id and history.operation_id == row.operation_id and history.source_sha256 != row.sha256:
            status = "invalid"
        if history:
            pinned = GroupSync(db, history.group_id)._operation(history.operation_id)
            if pinned is None or pinned.sha256 != history.source_sha256:
                status = "invalid"
        variants = set()
        for candidate in rows:
            if candidate.session_uuid != row.session_uuid:
                continue
            try:
                variant = verified_operation(db, candidate)
                variants.add(digest(variant.bundle.manifest.model_dump(mode="json")))
            except (SyncError, ValueError, TypeError, KeyError, RecursionError):
                pass
        conflict_count = max(0, len(variants) - 1) + int(normal is not None and history is None)
        source = db.get(SyncSession, row.session_uuid)
        if source is not None and source.manifest_sha256 != hashed:
            conflict_count = max(1, conflict_count)
        tracks = []
        dependencies = {}
        if status is None and manifest and source and source.manifest_sha256 == hashed:
            try:
                service = PeerSync(db)
                detail = service.detail(row.session_uuid)
                dependencies = {ref["logical_track_id"]:
                    "unbound" if ref["local_track_id"] is not None and service._guard(db.get(Track, ref["local_track_id"])) is None
                    else ref["asset_state"] for ref in detail["dependencies"]}
            except (SyncError, ValueError, TypeError, KeyError):
                status = "invalid"
        if manifest:
            tracks = [{"logical_track_id": str(ref.logical_track_id), "expected_asset": ref.asset.model_dump() if ref.asset else None,
                       "asset_state": dependencies.get(str(ref.logical_track_id), "unbound")} for ref in manifest.tracks]
        if status is None:
            states = {track["asset_state"] for track in tracks}
            status = ("conflicted" if conflict_count else "projection-pending" if not projected else
                      "unbound" if "unbound" in states else "missing-assets" if "missing" in states else
                      "changed-assets" if states & {"changed", "partial"} else
                      "unverified-assets" if "unverified" in states else "metadata-ready")
        group = db.get(DeviceGroup, row.group_id)
        relays = [device(db, row.group_id, possession.device_id) for possession in db.scalars(
            select(GroupPossession).where(GroupPossession.group_id == row.group_id,
                GroupPossession.operation_id == row.operation_id).order_by(GroupPossession.device_id))
            if possession.device_id != row.origin_device_id and (group is None or possession.device_id != group.device_id)]
        fallback = normal.started_at.replace(tzinfo=UTC) if normal else datetime(1970, 1, 1, tzinfo=UTC)
        result.append(GroupSessionView.model_validate({"format": "manadj-group-session-view/v1",
            "group_id": UUID(row.group_id), "operation_id": UUID(row.operation_id), "session_uuid": UUID(row.session_uuid),
            "operation_sha256": row.sha256, "manifest_sha256": hashed,
            "origin": {**device(db, row.group_id, row.origin_device_id), "device_id": UUID(row.origin_device_id)},
            "relays": [{**relay, "device_id": UUID(relay["device_id"])} for relay in relays],
            "started_at": manifest.started_at if manifest else fallback,
            "ended_at": manifest.ended_at if manifest else fallback, "status": status, "projected": projected,
            "playable": False, "editable": False, "conflict_count": conflict_count,
            "tracks": [{**track, "logical_track_id": UUID(track["logical_track_id"])} for track in tracks]}))
    # A missing ledger row never makes a previously group-owned normal row a
    # recorded source. Keep an explicit non-playable tombstone in the same UI.
    query = select(RecordedSession).join(GroupHistory)
    if uuid is not None:
        query = query.where(RecordedSession.uuid == canonical_uuid(uuid))
    represented = {str(view.session_uuid) for view in result}
    for normal in db.scalars(query):
        if normal.uuid in represented:
            continue
        history = normal.group_history
        origin = device(db, history.group_id, history.origin_device_id)
        result.append(GroupSessionView(format="manadj-group-session-view/v1", group_id=UUID(history.group_id),
            operation_id=UUID(history.operation_id), session_uuid=UUID(normal.uuid), operation_sha256=history.source_sha256,
            manifest_sha256=history.manifest_sha256, origin={**origin, "device_id": UUID(origin["device_id"])}, relays=[],
            started_at=normal.started_at.replace(tzinfo=UTC), ended_at=normal.ended_at.replace(tzinfo=UTC),
            status="invalid", projected=True, playable=False, editable=False, conflict_count=0, tracks=[]))
    return result


def project(db, group_id, operation_id):
    group = GroupSync(db, group_id)
    # Snapshot import remains the existing immutable/conflict-preserving seam.
    group.project(operation_id)
    group._lock()
    row = group._operation(operation_id)
    operation = verified_operation(db, row)
    manifest = operation.bundle.manifest
    hashed = digest(manifest.model_dump(mode="json"))
    normal = db.scalar(select(RecordedSession).where(RecordedSession.uuid == row.session_uuid))
    duplicate = normal is not None
    if normal is not None and (normal.group_history is None or normal.group_history.manifest_sha256 != hashed):
        raise SyncError(409, "group_history_uuid_conflict")
    if normal is None:
        normal = RecordedSession(uuid=row.session_uuid, started_at=manifest.started_at.replace(tzinfo=None),
            ended_at=manifest.ended_at.replace(tzinfo=None), origin=device(db, row.group_id, row.origin_device_id)["label"])
        db.add(normal)
        db.flush()
        normal.group_history = GroupHistory(group_id=row.group_id, operation_id=row.operation_id,
            origin_device_id=row.origin_device_id, source_sha256=row.sha256, manifest_sha256=hashed)
    session_uuid = row.session_uuid
    db.commit()
    return {"session_uuid": session_uuid, "duplicate": duplicate, "playable": False, "editable": False}


def project_received(db, group_id, operation_id):
    """Best-effort derived projection AFTER the durable metadata receipt.

    Failure never changes the accepted ledger or grants fallback authority. The
    normal history view reports pending/conflicted/revoked and can be retried.
    """
    try:
        row = GroupSync(db, group_id)._operation(operation_id)
        group = db.get(DeviceGroup, str(group_id))
        operation = verified_operation(db, row) if row is not None else None
        local = group and operation and group.device_id == str(operation.origin_device_id)
        db.rollback()  # close this read before entering the fresh write seam
        if not local:
            project(db, group_id, operation_id)
    except (SyncError, SQLAlchemyError, OSError, ValueError, TypeError, KeyError):
        db.rollback()
        logger.warning("Group Session history projection unavailable; durable evidence retained", exc_info=True)
    finally:
        db.rollback()  # response serialization must not retain a read transaction

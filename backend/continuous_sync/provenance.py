"""Fail-closed bridge until signed assets/binding-aware replay is implemented.

Do not pass received continuous rows off as locally recorded event evidence.
The signed operation body is the authority; owner/origin columns only add denial.
"""
import json
from sqlalchemy import select
from fastapi import HTTPException
from .models import Operation, SessionOwner


def received(db, sid):
    if db is None:
        return False
    from backend.peer_sync.models import DeviceGroup
    from .service import Replica
    for owner in db.scalars(select(SessionOwner).where(SessionOwner.session_uuid == sid)):
        local = db.get(DeviceGroup, owner.group_id)
        if local is None or owner.origin_id != local.device_id:
            return True
    for row in db.scalars(select(Operation)):
        try:
            body = json.loads(row.body)
            if body['entity'] != 'session:' + sid:
                continue
            replica = Replica(db, row.group_id)
            checked, _, hashed = replica._validate({'body': body, 'signature': row.signature})
            local = db.get(DeviceGroup, row.group_id)
            if hashed != row.sha256 or local is None or checked['origin_id'] != local.device_id:
                return True
        except Exception as error:
            raise HTTPException(409, 'continuous_history_source_unavailable') from error
    from backend.models import Session
    session = db.scalar(select(Session).where(Session.uuid == sid))
    return bool(session and session.origin and session.origin.startswith('own-device:'))


def deny(db, sid):
    if received(db, sid):
        raise HTTPException(409, 'continuous_history_replay_and_derivation_pending_verified_assets')

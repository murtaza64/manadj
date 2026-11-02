"""Signed group-only HTTP adapter. No network membership/provisioning endpoint."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from ..database import get_db
from ..peer_inventory.router import parse
from .group import GroupSync
from .group_contracts import Signed
from .service import SyncError

router = APIRouter()
Database = Annotated[Session, Depends(get_db)]


async def invoke(request, group_id, db, method):
    try:
        signed = await parse(request, Signed)
        result = getattr(GroupSync(db, group_id), method)(signed)
        return result.model_dump() if isinstance(result, Signed) else result
    except SyncError as error:
        db.rollback()
        raise HTTPException(error.status, error.code) from None
    except (ValueError, TypeError, KeyError, RecursionError):
        db.rollback()
        raise HTTPException(422, "invalid_group_message") from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "group_constraint_conflict") from None
    except OperationalError:
        db.rollback()
        raise HTTPException(503, "group_database_unavailable") from None


@router.post("/{group_id}/deliver")
async def deliver(group_id: UUID, request: Request, db: Database):
    return await invoke(request, group_id, db, "receive")


@router.post("/{group_id}/pull")
async def pull(group_id: UUID, request: Request, db: Database):
    return await invoke(request, group_id, db, "pull")


@router.post("/{group_id}/ack")
async def ack(group_id: UUID, request: Request, db: Database):
    return await invoke(request, group_id, db, "accept_ack")

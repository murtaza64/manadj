"""Manual local artifact import/export. No device token or friend authority admitted."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from ..database import get_db
from ..peer_inventory.router import local_control, parse
from ..peer_inventory.contracts import LocalId
from .contracts import BindBody, Bundle, ExportBody, GuardBody, SourceBody, Strict
from .service import PeerSync, SyncError

router = APIRouter(dependencies=[Depends(local_control)])
Database = Annotated[Session, Depends(get_db)]


async def invoke(db, method, *args, request=None, model=None):
    try:
        if model is not None:
            args = (*args, await parse(request, model))
        return getattr(PeerSync(db), method)(*args)
    except SyncError as error:
        db.rollback()
        raise HTTPException(error.status, error.code) from None
    except (ValueError, TypeError, KeyError, RecursionError):
        db.rollback()
        raise HTTPException(422, "invalid_peer_session_exchange") from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "peer_sync_constraint_conflict") from None
    except OperationalError:
        db.rollback()
        raise HTTPException(503, "peer_sync_database_unavailable") from None


@router.get("/identity")
async def identity(db: Database):
    return await invoke(db, "identity")


@router.post("/identity")
async def initialize(request: Request, db: Database):
    return await invoke(db, "initialize", request=request, model=Strict)


@router.post("/sources")
async def accept(request: Request, db: Database):
    return await invoke(db, "accept", request=request, model=SourceBody)


@router.get("/tracks/{local_id}")
async def track(local_id: LocalId, db: Database):
    return await invoke(db, "track", local_id)


@router.post("/tracks/{local_id}/select")
async def select(local_id: LocalId, request: Request, db: Database):
    return await invoke(db, "select_track", local_id, request=request, model=Strict)


@router.post("/tracks/{local_id}/identify")
async def identify(local_id: LocalId, request: Request, db: Database):
    return await invoke(db, "identify", local_id, request=request, model=GuardBody)


@router.post("/tracks/{local_id}/bind")
async def bind(local_id: LocalId, request: Request, db: Database):
    return await invoke(db, "bind", local_id, request=request, model=BindBody)


@router.post("/sessions/{sid}/export")
async def export(sid: UUID, request: Request, db: Database):
    return await invoke(db, "export", sid, request=request, model=ExportBody)


@router.post("/imports")
async def receive(request: Request, db: Database):
    return await invoke(db, "receive", request=request, model=Bundle)


@router.get("/sessions")
async def sessions(db: Database):
    return await invoke(db, "sessions")


@router.get("/sessions/{sid}")
async def detail(sid: UUID, db: Database):
    return await invoke(db, "detail", sid)


@router.get("/sessions/{sid}/conflicts")
async def conflicts(sid: UUID, db: Database):
    return await invoke(db, "conflicts", sid)

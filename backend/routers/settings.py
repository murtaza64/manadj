"""Settings API (settings, #176): persisted UI preferences.

Key -> raw preference string (what the frontend used to keep per-origin in
localStorage). The DB is the source of truth so sandbox/lane clones inherit
the real app's preferences; the frontend hydrates on boot and writes
through. Values are opaque strings — the backend stores what the client
asserts.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from ..database import get_db
from ..models import AppSetting

router = APIRouter()


class SettingValue(BaseModel):
    value: str


class SettingsSeed(BaseModel):
    settings: dict[str, str]


@router.get("")
def list_settings(db: Session = Depends(get_db)) -> dict:
    rows = db.query(AppSetting).all()
    return {"settings": {row.key: row.value for row in rows}}


@router.put("/{key}")
def put_setting(key: str, body: SettingValue, db: Session = Depends(get_db)) -> dict:
    # Atomic upsert: concurrent first-writes of the same key race (React
    # StrictMode double-effects) — ON CONFLICT beats get-then-insert.
    stmt = sqlite_insert(AppSetting).values(key=key, value=body.value)
    stmt = stmt.on_conflict_do_update(
        index_elements=[AppSetting.key],
        set_={"value": body.value, "updated_at": func.now()},
    )
    db.execute(stmt)
    db.commit()
    return {"key": key, "value": body.value}


@router.delete("/{key}", status_code=204)
def delete_setting(key: str, db: Session = Depends(get_db)) -> None:
    row = db.get(AppSetting, key)
    if row is not None:
        db.delete(row)
        db.commit()


@router.post("/seed")
def seed_settings(body: SettingsSeed, db: Session = Depends(get_db)) -> dict:
    """One-time seed from a client's localStorage: only applies when the
    settings table is empty (first boot against a pre-settings DB), so a
    fresh sandbox clone can never clobber the real app's rows."""
    if db.query(AppSetting).first() is not None:
        return {"seeded": False}
    for key, value in body.settings.items():
        db.add(AppSetting(key=key, value=value))
    db.commit()
    return {"seeded": True}

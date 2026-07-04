"""Transition-templates API (mix-editor issue 03).

Templates are global library artifacts saved by explicit user acts, so this
is plain per-row CRUD keyed by the client-generated uuid — deliberately
unlike Transitions' client-authoritative pair-replace (ADR 0011), whose
reconcile machinery exists only because autosave has no discrete create/
update moments. Applying a template to a pair happens entirely client-side;
the server never resolves anchors.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter()


def _row(t: models.TransitionTemplate) -> schemas.TransitionTemplateRow:
    return schemas.TransitionTemplateRow(
        uuid=t.uuid,
        name=t.name,
        align_a_base=t.align_a_base,
        align_delta_beats=t.align_delta_beats,
        align_b_base=t.align_b_base,
        before_beats=t.before_beats,
        after_beats=t.after_beats,
        scalable=t.scalable,
        lanes=json.loads(t.lanes_json),
    )


def _get(db: Session, uuid: str) -> models.TransitionTemplate:
    row = (
        db.query(models.TransitionTemplate)
        .filter(models.TransitionTemplate.uuid == uuid)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Template {uuid} not found")
    return row


@router.get("", response_model=list[schemas.TransitionTemplateRow])
def list_templates(db: Session = Depends(get_db)):
    """All templates, creation-ordered (the dropdown's order)."""
    rows = db.query(models.TransitionTemplate).order_by(models.TransitionTemplate.id).all()
    return [_row(t) for t in rows]


@router.post("", response_model=schemas.TransitionTemplateRow, status_code=201)
def create_template(payload: schemas.TransitionTemplateItem, db: Session = Depends(get_db)):
    exists = (
        db.query(models.TransitionTemplate.id)
        .filter(models.TransitionTemplate.uuid == payload.uuid)
        .first()
    )
    if exists is not None:
        raise HTTPException(status_code=409, detail=f"Template {payload.uuid} already exists")
    row = models.TransitionTemplate(
        uuid=payload.uuid,
        name=payload.name,
        align_a_base=payload.align_a_base,
        align_delta_beats=payload.align_delta_beats,
        align_b_base=payload.align_b_base,
        before_beats=payload.before_beats,
        after_beats=payload.after_beats,
        scalable=payload.scalable,
        lanes_json=json.dumps(payload.lanes),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row(row)


@router.put("/{uuid}", response_model=schemas.TransitionTemplateRow)
def update_template(
    uuid: str, payload: schemas.TransitionTemplateItem, db: Session = Depends(get_db)
):
    """Full-row update (rename, re-save over). uuid is immutable."""
    if payload.uuid != uuid:
        raise HTTPException(status_code=400, detail="uuid is immutable")
    row = _get(db, uuid)
    row.name = payload.name
    row.align_a_base = payload.align_a_base
    row.align_delta_beats = payload.align_delta_beats
    row.align_b_base = payload.align_b_base
    row.before_beats = payload.before_beats
    row.after_beats = payload.after_beats
    row.scalable = payload.scalable
    row.lanes_json = json.dumps(payload.lanes)
    db.commit()
    db.refresh(row)
    return _row(row)


@router.delete("/{uuid}", status_code=204)
def delete_template(uuid: str, db: Session = Depends(get_db)):
    db.delete(_get(db, uuid))
    db.commit()
    return Response(status_code=204)
